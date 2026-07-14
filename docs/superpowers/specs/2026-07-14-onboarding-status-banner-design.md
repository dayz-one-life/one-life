# Onboarding / Status Banner — Design

**Date:** 2026-07-14
**Branch:** `feature/onboarding-status-banner`
**Status:** Approved (design), pending implementation

## Summary

A persistent, site-wide banner directly under the masthead that reflects the visitor's
account-onboarding state and tells them the single next thing to do. It replaces the
masthead's stateful amber CTA for every state *except* verified. The banner is the app's
primary onboarding rail; the masthead's right-hand slot collapses to a quiet **Account**
link when signed-in-but-unverified, and to the amber gamertag CTA only when verified.

Visual direction (approved in the visual companion): a single amber-glow bar —
`bg-amber/20` with `border-y-2 border-amber` — bigger type than the previous CTA, on-brand
with the dark theme.

## States

There is exactly one derived **account status** that drives both the banner and the
masthead slot. Given `signedIn`, a loading flag, and the user's gamertag links:

| Status | Condition | Banner | Masthead slot |
|---|---|---|---|
| `loading` | session pending, or links loading while signed in | none (no flash) | loading placeholder (existing `…`) |
| `signedOut` | no session | **Invite:** "Sign in to claim your gamertag" → `/login` | *empty* |
| `unlinked` | signed in, no active link | **Invite:** "Link your gamertag to get started" → `/account/claim` | quiet **Account** link → `/account` |
| `pending` | signed in, active link `status === "pending"` | **Verify:** emotes + live progress + expiry + cancel | quiet **Account** link → `/account` |
| `verified` | signed in, active link `status === "verified"` | none | amber **{GAMERTAG}** CTA → `/account` |

"Active link" = `activeLink(links)` (existing helper: first link with status `pending|verified`).

### Banner variants

**Invite** (`signedOut`, `unlinked`) — two-column on desktop (copy left, big button
right), stacks to single column with a full-width button on mobile. No ⚠ icon (it's an
invitation). Fields: title, subtitle, button label, button href.

- signedOut → "Sign in to claim your gamertag" / "One account tracks your lives across
  every One Life server and lets you verify the gamertag that's yours." / **Sign in →** /
  `/login`
- unlinked → "Link your gamertag to get started" / "Connect your Xbox gamertag to claim
  your lives and prove on the roster that they're yours." / **Link gamertag →** /
  `/account/claim`

**Verify** (`pending`) — ⚠ title "Finish verifying **{GAMERTAG}**", a `{n} / {total} DONE`
progress pill, the subtitle "Log in to any One Life server and perform these emotes in
order — we detect them automatically.", then the emote sequence as chips (completed ones
struck through with ✓), and a footer with `expires in {…}` and a **Cancel claim** link.

- **Expired challenge** (`challenge.expired`, or defensively a pending link with no
  challenge): replace the emote chips with copy "Your verification for {GAMERTAG} expired"
  and a **Start a new challenge →** button (re-claim). Keep **Cancel claim**.

## Data & backend

**No backend changes.** The list endpoint the masthead already calls
(`GET /me/gamertag-links` → `useGamertagLinks`) runs `loadLink` per row, which serializes
the full `challenge` (`sequence` + `progressIndex` + `expiresAt` + `expired`) for pending
links (`apps/api/src/routes/gamertag-links.ts`). Everything the Verify banner renders is
already client-side.

**One client change — live polling.** `useGamertagLinks` currently never refetches. Add a
`refetchInterval` that polls (5s) only while an active link is `pending`, so the banner's
progress ticks live as the user performs emotes and flips to `verified` on completion.
This also keeps the masthead label fresh. It stops polling once no pending link remains.

```ts
useQuery({
  queryKey: ["gamertag-links"],
  queryFn: getGamertagLinks,
  enabled,
  refetchInterval: (q) =>
    q.state.data?.some((l) => l.status === "pending") ? 5000 : false,
});
```

- **Cancel claim** → existing `useCancelLink(link.id)`.
- **Start a new challenge** → existing `useClaimGamertag()` with the same gamertag (POST is
  idempotent; reissues an expired challenge). On success it invalidates `gamertag-links`.
- **Expiry countdown** → derived from `challenge.expiresAt`; format as `expires in Xh` (or
  `Ym` under an hour, `expired` at/after). Recomputes on each poll-driven re-render.

## Component architecture

Follows the repo convention: **presentational components take props and are unit-tested;
smart wrappers read hooks and are not** (mirrors `ClaimStatus`/`EmoteSequence` vs the
pages).

- **`lib/account-status.ts`** (pure, tested) — `accountStatus({ signedIn, loading, links })`
  returns the discriminated union above (`loading | signedOut | unlinked | pending |
  verified`, carrying the active link where relevant). Single source of truth for both
  banner and masthead.
- **`components/status-banner.tsx`** — presentational `StatusBanner` taking a
  `{ status, onCancel, onReclaim, canceling, reclaiming }`-style prop set; renders the
  correct variant (or `null` for `loading`/`verified`). Uses a shared `BannerShell` for the
  amber-glow chrome and an `EmoteChips` sub-piece for the sequence+progress. Fully unit-tested.
- **`components/status-banner-container.tsx`** (or an exported smart wrapper in the same
  file) — reads `useSession` + `useGamertagLinks(signedIn)`, computes `accountStatus`, wires
  the `useCancelLink` / `useClaimGamertag` mutations, and renders `<StatusBanner/>`. This is
  what the root layout renders. Not unit-tested (like the pages).
- **`components/header.tsx`** — refactor the CTA derivation to consume `accountStatus`:
  `signedOut` → render nothing; `unlinked`/`pending` → quiet **Account** link (`text-dim`
  underline, not the amber CTA); `verified` → amber gamertag CTA; `loading` → existing
  placeholder.
- **`app/layout.tsx`** — render the banner container between `<Masthead/>` and the page,
  inside the existing root-level `<QueryProvider>` (one shared cache — already there).

Reuse the existing `EmoteSequence` where it fits, but the banner's chips are a compact
horizontal layout distinct from the claim page's vertical list; a small dedicated
`EmoteChips` presentational piece is cleaner than overloading `EmoteSequence` with a variant.

## Testing

- **`lib/account-status.test.ts`** — table of inputs → each status (signed out; signed in +
  no links; + pending link; + verified link; loading permutations).
- **`components/status-banner.test.tsx`** — one case per variant driven by props: signedOut
  invite (copy + `/login` link), unlinked invite (copy + `/account/claim` link), pending
  verify (title with gamertag, emote chips, `1 / 3 DONE`, expires text, Cancel calls
  `onCancel`), expired (Start-a-new-challenge calls `onReclaim`), verified/loading → renders
  nothing.
- **`components/header.test.tsx`** — currently broken (no `QueryClientProvider`, stale
  assertion). Rewrite to test the masthead's slot per status. Simplest path: have the
  masthead's rendering derive from `accountStatus` and test a small presentational slice, or
  wrap the render in a `QueryClientProvider` + stub the hooks. Prefer testing the pure
  derivation (`account-status.test.ts`) and a thin presentational masthead slot so we avoid
  hook-mocking.
- Follow TDD: write the failing test for each unit before implementing it.

## Out of scope

- Dismissible/collapsible banner (design is intentionally persistent).
- Any transient "verified!" celebration — verified simply removes the banner.
- Changes to the `/account` and `/account/claim` pages (they keep their existing controls;
  minor redundancy with the banner is acceptable).
- Backend/API changes.

## CHANGELOG / CLAUDE.md

Per the workflow, update `CHANGELOG.md` (this PR) and `CLAUDE.md` (SP2 section — the
masthead CTA description becomes the banner-driven onboarding rail) as the last steps
before the PR.
