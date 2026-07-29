# Terms & Conditions and Privacy Policy pages — design

**Date:** 2026-07-29
**Status:** approved, not yet implemented
**Surfaces:** `apps/web` — two new routes, one new component, three wiring changes

## Why

`dayzonelife.com` collects a Discord identity, an email, session IP addresses, uploaded avatar
images, linked Xbox gamertags, friendships, push subscriptions, and in-game telemetry down to map
coordinates — and it sends a player's gamertag to a third-party LLM to have an obituary written
about them. None of that is disclosed anywhere on the site today, and there is no published
contact for a deletion request. There is also no written basis for account-level enforcement
against a cheater.

These two pages close both gaps.

## Decisions that fix the content

Settled during brainstorming; every one of them shapes wording, so record them rather than
re-deriving them later.

| Question | Decision |
| --- | --- |
| Who operates One Life | An individual, in the US, as a hobby. No company is named. |
| Compliance depth | Honest plain English. No GDPR article citations, no legal-basis table, no DSAR procedure — it would describe a compliance program that does not exist. |
| Published contact | `admin@dayzonelife.com` — the only contact on either page. **Prerequisite: mail must actually be deliverable at that address (forwarding counts) before these pages ship.** |
| T&C scope | The website *and* the game servers as one document, including in-game conduct. Players experience One Life as one thing, and a single document is what gives account-level enforcement a written basis. |
| Voice | Plain and direct, second person, quietly in the site's register. Not tabloid — legal pages are where a joke costs trust. Not "the Service"/"the Company" legalese either. |
| Deletion promise | Account data is deleted; **the gameplay record stands.** See "The deletion promise" below. |
| Governing law | Arizona, USA. |

### The deletion promise

This is the one clause the architecture has to be able to keep, so it is stated narrowly and
deliberately.

Deleted on request: the `user` row, email, `account` OAuth tokens, `session` rows (and with them
the stored IP addresses and user-agents), the `avatars` row, `push_subscriptions`, `friendships`,
`user_preferences`, `location_shares`, the `token_transactions` ledger and the `gamertag_links`
row.

**Not deleted:** anything in `events`, and the projections folded from it — lives, sessions,
kills, hits, positions, deaths — plus any `articles` obituary. The event log is append-only and
every projection rebuilds from it; scrubbing a gamertag out of it would break the rebuild
invariant that the whole ingest design rests on. It is also the product's premise: the record is
permanent.

Two options were considered and rejected. Retracting obituaries on request
(`articles.status='retracted'` already exists) is buildable but is a read-model change needing its
own spec, and is deliberately **not** promised by this page. Full erasure of a gamertag from the
event log is not offered at all.

## Approach

Content is authored as typed data modules rendered by one shared presentational component — the
same idiom `/about` already uses for its `STEPS` and `RULES` arrays. Two hand-written TSX pages
were rejected because the pages must look identical and would drift on the first edit; MDX was
rejected because the repo has no MDX today and two static pages do not justify `@next/mdx`, its
config, and a new build surface.

### Files

```
apps/web/src/app/(site)/(boxed)/terms/page.tsx        thin route + metadata
apps/web/src/app/(site)/(boxed)/privacy/page.tsx      thin route + metadata
apps/web/src/components/legal/legal-doc.tsx           shared presentation
apps/web/src/content/legal/terms.ts                   LegalSection[]
apps/web/src/content/legal/privacy.ts                 LegalSection[]
apps/web/src/content/legal/effective-date.ts          EFFECTIVE_DATE
```

`(boxed)` is the correct group: these are ordinary max-width prose pages like `/about`, and they
inherit the masthead, footer and tab bar without touching the shell.

Both pages are fully static — no fetches. The loading/failed/empty/zero rule therefore does not
apply here; there is nothing that can degrade, and no `count` union to render.

`EFFECTIVE_DATE` is a single exported constant that both pages print, so one edit cannot leave one
page claiming a stale date while the other updates.

### `LegalDoc`

```ts
interface LegalSection { id: string; heading: string; body: ReactNode }

interface LegalDocProps {
  title: string;
  standfirst: string;
  effectiveDate: string;
  sections: LegalSection[];
}
```

Renders the `/about` furniture: `Kicker`, a `font-display` uppercase `h1`, the standfirst
paragraph in `font-sans text-lg text-ink-soft`, a `Last updated` line in `font-mono text-xs
uppercase`, then each section as `<section id={id}>` with an `h2` carrying the
`border-b-[3px] border-ink` rule.

`body` is a `ReactNode` so a section can hold a list or a `<dl>` directly. The component gains no
markup mini-language, and it stays purely presentational — it holds no copy of its own.

Section `id`s give every clause a stable `#anchor`, so a deletion request can be answered with a
link straight to the relevant paragraph.

### Wiring

**Footer.** Today it is one centered line — `About · Obituaries · tagline` — and four links will
not survive a 320px column. The links become a `flex-wrap` centered group (About · Obituaries ·
Terms · Privacy) with the tagline dropping onto its own line beneath.

> ⚠️ The `pb-[calc(18px+4rem+env(safe-area-inset-bottom))]` gutter stays on the `<footer>`
> element itself. That comment documents a shipped bug where the fixed TabBar covered the About
> link and made it unreachable on a phone; adding a second row makes the gutter more load-bearing,
> not less. Do not move it onto the layout's content column.

**Sitemap.** Add `/terms` and `/privacy` to `STATIC_PATHS` in `apps/web/src/app/sitemap.ts`. They
carry no `lastModified`, consistent with the existing rule there that a fabricated value trains
crawlers to ignore the field.

**Sign-in consent.** A single line under the Discord button — "Signing in means you accept the
Terms and Privacy Policy", both linked. Without it the pages are decoration; this is the moment a
player actually agrees to them.

## Terms & Conditions — content

1. **Who runs this.** One person, in the US, as a hobby. No company. Contact
   `admin@dayzonelife.com`. Not affiliated with, endorsed by, or connected to Bohemia Interactive,
   DayZ, Microsoft, Xbox, or Nitrado.
2. **Who can play.** 13 or older. Your platform's terms and the game's age rating remain your
   responsibility.
3. **Your account.** Discord sign-in, one account per person, you are responsible for what happens
   under it.
4. **Your gamertag.** One tag per account, forever. Emote verification is the only accepted proof.
   Anyone may attempt a tag; first verification wins. Claiming a tag that is not yours is grounds
   for removal.
5. **Unban tokens.** Earned, never bought. No cash value, not property, not redeemable for
   anything off the site. Transfers are final. Tokens obtained by exploit can be voided. If the
   economy changes or the site closes, tokens are worth nothing and nothing is owed.
6. **The record.** Lives, deaths, kills and obituaries are published publicly and permanently.
   **Obituaries are machine-written and deliberately unkind; they are commentary on a death in a
   video game, not statements of fact about you as a person.**
7. **Server conduct.** Cheating, exploits, duping, ban evasion with a second gamertag, harassment
   and slurs, doxxing, real-world threats.
8. **Avatars you upload.** You keep ownership and grant permission to display it. Nothing illegal,
   hateful, sexual, or belonging to someone else. Any avatar can be removed without notice.
9. **Enforcement and appeals.** The 24-hour ban is mechanical, not a judgement, and is not
   appealable. Admin bans are discretionary, may be permanent, and are appealed by email.
10. **Availability.** A hobby project. No uptime promise. Servers can be wiped, moved or shut
    down, and data can be lost. No compensation.
11. **Disclaimers.** Provided as-is.
12. **Liability.** Limited to the extent permitted by law.
13. **Changes.** Posted with a new date; continued use is acceptance.
14. **Governing law.** Arizona, USA.

## Privacy Policy — content

Every item below was checked against the code, not assumed.

1. **The short version.** No ads, no analytics, no trackers, nothing sold. *Verified: no
   gtag/Plausible/PostHog/umami call exists anywhere in `apps/web`.*
2. **What signing in gives us.** From Discord: display name, email, avatar image, Discord account
   ID, and OAuth access/refresh tokens (`user`, `account`).
3. **What your browser gives us.** A session cookie, and the **IP address and user-agent stored on
   the `session` row**. With notifications enabled, a push endpoint, its `p256dh`/`auth` keys, and
   the device user-agent (`push_subscriptions`).
4. **What the game servers record.** The DayZ server writes an admin log; we parse it. Gamertag,
   connects and disconnects, **map coordinates** (`positions`), kills, hits, unconsciousness,
   building, deaths, and the emotes used for verification. **Chat is not captured** — *verified:
   `packages/adm-parser` has no chat handling at all.*
5. **What you add yourself.** An uploaded avatar (stored as bytes in Postgres), your gamertag
   claim, friendships, and per-friend location and presence toggles.
6. **Who sees what.** Public: gamertag, lives, deaths, obituaries, board position. Owner-only:
   coordinates, email, IP. Friends-only: live location and presence, and only where you enabled
   it. States plainly that coordinate routes take no player parameter and are never cached.
7. **Who else touches it.** Nobody buys it. Four parties necessarily see something: **Discord**
   (sign-in), **Nitrado** (game hosting), your browser vendor's **push service** if notifications
   are on, and **OpenRouter / Anthropic's Claude**, which receive your gamertag, your killer's
   gamertag, and the details of the death in order to write the obituary
   (`apps/newsdesk/src/facts.ts`). The AI disclosure is the sharpest omission risk on this page —
   do not drop it.
8. **Cookies.** The session cookie, and nothing else.
9. **How long it is kept.** Indefinitely. *Verified: there is no pruning, retention or purge job
   anywhere in the repo, and `events` is append-only by design.* Saying so beats promising a
   schedule that is not run.
10. **Deleting your account.** Email `admin@dayzonelife.com`. See "The deletion promise" above for
    exactly what goes and what stays.
11. **Under-13s.** Not for them; tell us and it gets removed.
12. **Changes.** Posted with a new date.
13. **Contact.** `admin@dayzonelife.com`.

## Testing

RTL asserts the DOM, never layout or contrast.

- `legal-doc.test.tsx` — renders the title, standfirst, effective date, and one `<section>` per
  entry carrying its `id`.
- A content-module test asserting every section `id` is non-empty and unique across each document,
  so a copy edit cannot silently collide two anchors and break a shared link.
- `terms/page.test.tsx` and `privacy/page.test.tsx` pin the **load-bearing clauses by content, not
  by count**: the contact address, the no-affiliation disclaimer, tokens having no cash value,
  obituaries being machine-written, the OpenRouter/Anthropic disclosure, and the Arizona
  governing-law line. This is the point of these tests — a later tidy-up that shortens the prose
  and drops a required disclosure must fail, not ship.
- `footer.test.tsx` extended to all four links, and to assert the `pb-[calc(...)]` gutter is still
  on the `<footer>` element.
- `sitemap.test.ts` extended for `/terms` and `/privacy`.

## Out of scope

- Retracting or hiding obituaries on request (would need its own spec).
- Any erasure of gamertags from the event log.
- A cookie consent banner — there is nothing to consent to beyond the session cookie.
- Payments, refunds, or purchase terms — no payment path exists in the repo.

## Needs a browser, not a test

Added to CLAUDE.md's outstanding-verification list rather than claimed as done:

- The four-link footer wrapping at 320px, and the tab-bar gutter still clearing the second row in
  PWA/standalone on a notched phone.

## Prerequisite before ship

`admin@dayzonelife.com` must actually receive mail. A privacy policy naming a dead address is
worse than one naming none.
