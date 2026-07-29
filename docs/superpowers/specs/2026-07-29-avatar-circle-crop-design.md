# Circle-cropped avatars — design

**Date:** 2026-07-29
**Status:** approved, not yet implemented
**Scope:** `apps/web` only. Presentation change. No migration, no API change, no env var, no
worker, no `--rebuild`.

## 1. Problem

Avatars render in eight places and disagree about their own shape. Six are square with a hairline
border; two are circles. The two circles are hand-rolled — they bypass the shared `Avatar`
component entirely and each carry their own `<img>`, their own fallback and their own sizing.

The goal is one shape — a circle — everywhere, with the rule stated once.

## 2. What is NOT changing

The `sharp` pipeline (`apps/api/src/lib/avatar-image.ts`) is untouched. Three consequences, all
deliberate:

- **Stored bytes stay square.** The circle is a CSS mask over a square 256x256 webp.
- **No hash churn.** `hash = sha256(image).slice(0, 16)` is taken over the *encoded output*
  (`avatar-image.ts:23`), so any change to the resize or encode options would change every
  avatar's hash and therefore every avatar's URL, orphaning every stored `avatars.hash` row until
  a re-processing pass ran. A CSS mask is retroactive to every existing avatar for free.
- **No new non-CSS surface needs the mask baked in.** The only OpenGraph route
  (`app/(site)/(boxed)/players/[slug]/opengraph-image.tsx`) renders no avatar at all — it draws
  the wordmark and skull only, and already fetches `avatarHash` without using it. If an avatar is
  ever added to an OG card, that is when baking becomes worth reconsidering.

Cropping behaviour is also unchanged: `fit: "cover"` still centre-crops on upload, and
`object-cover` still fills the box. A circle trims the corners of that centre crop. Letting the
player choose *which* region the circle keeps is an interactive-cropper feature and is explicitly
out of scope here.

## 3. Design

### 3.1 One shape authority

`apps/web/src/components/shared/avatar.tsx` becomes the only place that states the shape. All
three of its branches — real image, initial disc, silhouette — gain `rounded-full`. The existing
`border-hairline` becomes the ring.

That single edit covers six surfaces retroactively:

| Surface | Size |
|---|---|
| survivors board — compact row | 28 |
| survivors board — podium row | 60 |
| survivors board — hero row | 96 |
| player dossier hero | 72 |
| upload preview (`AvatarPanel`) | 76 |
| life timeline hero | 132 |

The 132px life-timeline hero is included with no exception. Every avatar on the site is a circle.

### 3.2 Two new props on `Avatar`

```ts
variant?: "paper" | "dark";  // default "paper"
className?: string;          // merged last
```

**`variant`** swaps the three surface tokens:

| Token | `paper` | `dark` |
|---|---|---|
| border | `border-hairline` | `border-dark-edge-bright` |
| fill | `bg-bone` | `bg-dark-well` |
| glyph | `text-ink-muted` | `text-paper` |

This is the two-surface token rule from `CLAUDE.md`. It gets its own test pinning the swap,
because RTL asserts the DOM and not contrast — an unswapped variant renders present, functional
and invisible, with the suite green. That is the failure mode that shipped as v0.26.0.

**`className`** is merged last through `cn`, which is `twMerge(clsx(...))`. twMerge resolves by
Tailwind class group, so a caller-supplied border class *replaces* the component's own rather than
sitting alongside it as a competing rule whose winner depends on stylesheet order. This is what
makes a single authority with per-surface overrides safe.

### 3.3 The two collapse sites

**`components/shell/account-affordance.tsx`** (masthead, 36px, dark surface). The button drops
`overflow-hidden rounded-full border border-dark-edge-bright bg-dark-well` and gains `group`. Its
hand-rolled `<img>`/initial-span conditional is replaced by:

```tsx
<Avatar hash={hash} size={36} fallbackInitial={initial} variant="dark"
        className="group-hover:border-red group-hover:text-red" />
```

The hover behaviour is preserved exactly; the ring and fill now come from `Avatar`.

**`components/account/identity-row.tsx`** (account panels, 40px, light surface). The hand-rolled
`<img>` and the local `AvatarDisc` both go, replaced by one:

```tsx
<Avatar hash={avatarHash ?? null} size={40} fallbackInitial={initialOf(name)} />
```

`AvatarDisc` is exported but has exactly one consumer — `IdentityRow` itself — so it is deleted,
not deprecated.

**Accepted visual change.** `AvatarDisc` today is `bg-discord` blurple with white text; `Avatar`'s
disc is `bg-bone` with muted ink. Collapsing adopts `Avatar`'s. The blurple is read as drift
rather than intent: it is the only Discord-coloured surface outside the login page, and it fires
for every provider rather than only Discord. This was raised explicitly and accepted.

**Two mechanical consequences of the collapse**, called out so they read as intended rather than
as accidents in the diff:

- `identity-row.tsx`'s `avatarSrc` import becomes unused once the hand-rolled `<img>` goes, and
  must be removed or lint fails.
- The masthead initial changes size. Today it is the button's `text-sm` (14px); through `Avatar`
  it becomes `size * 0.45` = 16.2px, which is the rule every other fallback disc already follows.
  The button's now-unused `font-display text-sm font-bold uppercase` classes go with it, but
  `text-paper` stays — it is the label colour for the rest of the button.

### 3.4 Not in scope

The other `rounded-full` occurrences in the repo are unrelated status dots
(`life/timeline.tsx`, `friends/online-friends.tsx`, `servers/standing-groups.tsx`,
`account/ladder-frame.tsx`). They are not avatars and are not touched.

## 4. Testing

Six existing test files cover these components: `shared/avatar.test.tsx`,
`account/identity-row.test.tsx`, `shell/account-affordance.test.tsx`,
`survivors/survivor-row.test.tsx`, `player/player-hero.test.tsx`, `life/hero.test.tsx`.

New coverage:

1. **Shape** — `rounded-full` present on all three `Avatar` branches (image, initial disc,
   silhouette).
2. **Token swap** — `variant="dark"` renders the dark tokens and *not* the paper ones, on all
   three branches. Proven against an implementation that ignores `variant`.
3. **Collapse** — `AccountAffordance` and `IdentityRow` render through `Avatar` rather than their
   own markup, in both the has-hash and no-hash states.
4. **Override** — a caller-supplied `className` border wins over the component's own, i.e. the
   twMerge behaviour §3.2 depends on is real rather than assumed.

**No browser pass required.** `border-radius` is neither a layout nor a stacking property, so
jsdom's blindness to paint order and geometry — the gap that shipped green-but-broken releases in
sub-project B and M1 — does not apply. This is a deliberate claim, not an omission: if a later
change to this component touches sizing, stacking or overflow, that reasoning no longer holds.

## 5. Deploy

Web-only, presentation-only. Plain `./deploy/deploy.sh`, **no `--rebuild`**. No migration, no new
table, no env var, no worker, no systemd unit. The `sharp` pipeline and the stored bytes are
untouched, so no avatar URL changes and no cache entry is invalidated — the
`max-age=31536000, immutable` serving header stays honest.
