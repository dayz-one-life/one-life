# Gamertag case-insensitivity — design

**Date:** 2026-07-22
**Status:** approved, not yet implemented
**Deploy:** plain `./deploy/deploy.sh`, no `--rebuild`

## 1. The invariant

**A gamertag identifies one human, case-insensitively, everywhere in the system.**

Xbox reserves gamertags case-insensitively — `Sasha` and `sasha` are never two different
people. Every design decision below rests on that assumption. If it were false, the unique
index in §5 would merge two real players, so it is stated here rather than left implicit.

The system does not hold that invariant today. It is enforced at four boundaries, and
**all four must land together** — §3 explains why three of them are not optional.

## 2. Why now

This closes the open backlog item recorded in `CLAUDE.md` under Friends F2 invariant 6:
`gamertag_links_verified_uniq` and `players_gamertag_uniq` are both case-sensitive, so two
users can hold verified links to `Sasha` and `sasha`, fold onto one `players` row, and a
viewer can receive another player's coordinates as their own dot on the friends map.
`getFriendPositions` guards the *labelling* consequence but does not close the hole.

An audit of `onelife-pre-v0.37.2-full.sql` (122 players, 8 gamertag links, 7 verified) found
the data **completely clean**:

| Check | Result |
|---|---|
| `players` rows colliding case-insensitively | 0 |
| Verified links colliding case-insensitively | 0 |
| Active (`pending`\|`verified`) links colliding | 0 |
| Links whose casing differs from their `players` row | 0 |
| Links with no matching `players` row at all | 0 |

So this is **prevention only — no remediation, no backfill, no data migration.** Doing it
now, while the data is clean, is what keeps it a two-index change instead of a merge project.

## 3. The three fixes the index cannot ship without

Swapping the unique indexes alone is not hardening — it converts three silent bugs into
louder failures, two of them outages.

### 3.1 The projector crash-loop (highest severity)

`apps/projector/src/pg-store.ts:13` resolves a player with a bare `eq(players.gamertag, …)`,
and `packages/projections/src/fold.ts:35` creates one whenever that returns null:

```ts
let player = await store.getPlayer(gamertag);
if (!player) player = await store.createPlayer(gamertag, dayzId, e.occurredAt);
```

Today a re-cased name silently mints a second `players` row. **Under a `lower(gamertag)`
unique index it raises 23505 inside the fold transaction instead.** This is an event-log
fold, so the projector retries the same event indefinitely: every projection stops
advancing, triggered by nothing more than Xbox reporting a name with different
capitalization.

`getPlayer` must therefore resolve case-insensitively in the same commit. That is also the
behaviour we want on its own merits — a re-cased name should find the existing identity.

`packages/projections/src/memory-store.ts:30` gets the same treatment, so the in-memory
store used by the fold tests keeps parity with Postgres.

### 3.2 The verifier never completes (live user-facing bug)

`apps/verifier/src/pg-store.ts` compares the ADM emote event's gamertag against
`gamertag_links.gamertag` with bare `eq()` in three places:

- `findPendingChallenges` (line 30) — the gate that decides whether an emote verifies a link
- `getVerifiedLinkId` (line 47) — the "someone else already won this gamertag" check
- `cancelOtherPendingLinks` (line 84) — cancellation of competing claims

Because the claim route stores raw user-typed casing (§3.3), a user who claims `sasha` while
the ADM logs `Sasha` matches nothing in `findPendingChallenges`. **They perform the emote
correctly, forever, and verification never completes.** No error is surfaced anywhere.

Post-index, `getVerifiedLinkId` failing to see its case-variant twin would let a second
verification reach the UPDATE and hit the new unique index, crashing the verifier tick.

### 3.3 The claim route stores whatever the user typed

`apps/api/src/routes/gamertag-links.ts:93` inserts the raw request-body gamertag:

```ts
const [row] = await tx.insert(gamertagLinks).values({ userId, gamertag, status: "pending" })
```

It is never resolved against `players.gamertag`. No unique index catches this — the link is
simply mis-cased relative to the player it names, which is what feeds §3.2.

Both prechecks in that route are case-sensitive too: `gamertag_not_seen` (line 57) and
`already_verified` (line 65). Left alone, a claim for `sasha` would pass the
`already_verified` guard while `Sasha` is verified by someone else, then fail on the new
unique index as an unhandled 23505 — a 500 where a 409 belongs.

## 4. Approach: canonicalize on write

The claim route resolves the submitted gamertag to the **canonical `players.gamertag`
casing** and stores that. One human therefore has one casing in every row that names them.

This is what makes the change small. There are 35 bare `eq()` gamertag comparisons elsewhere
in the codebase, and they stay untouched and correct by construction. Sweeping them to
`lower()` was considered and rejected: `CLAUDE.md` records that a `lower()` predicate defeats
`positions_player_idx` past its `server_id` prefix, and defeats both partial expression
indexes from migration `0017` (`articles_subject_idx` / `articles_killer_idx`). The 29 sites
that already use `lower()` are the cross-table identity joins, where it is required; the
convention is deliberate and unchanged.

### 4.1 Casing is frozen at first sight

`players.gamertag` keeps its first-seen casing permanently. `getPlayer` will *find* the row
for any casing, but `touchPlayer` does not rewrite it.

This is deliberate. Every denormalized copy of a gamertag — `bans.gamertag`,
`kills.killerGamertag`, `articles.gamertag`, `notifications`, `positions` — was written with
the casing current at the time. Rewriting `players.gamertag` would leave all of them
mismatched, and those columns are read by exactly the 35 bare `eq()` sites §4 relies on
leaving alone. A stale capitalization on a profile is a cosmetic cost; a rewrite is a
correctness one.

## 5. Migration `0024`

Hand-written SQL with a hand-appended `meta/_journal.json` entry, per the practice recorded
in `CLAUDE.md` for `0018+`: the drizzle snapshot chain is broken (`meta/` stops at
`0014_snapshot.json`), so `drizzle-kit generate` diffs against a stale snapshot and emits
wrong SQL.

Three steps:

1. **Precheck.** A `DO` block that raises an exception naming any case-colliding gamertags in
   either table. Expected to find zero — but the audited dump is `pre-v0.37.2`, several
   releases stale, so this converts "confusing 23505 partway through a deploy" into "named
   gamertags, deploy aborted, nothing changed."
2. `DROP INDEX players_gamertag_uniq` → `CREATE UNIQUE INDEX players_gamertag_uniq ON
   players (lower(gamertag))`.
3. The same for `gamertag_links_verified_uniq`, preserving its
   `WHERE status = 'verified'` partial clause.

`schema.ts` is updated to express both as expression indexes. There is precedent in that
file: `articles_subject_idx` is already declared as ``.on(sql`lower(${t.gamertag})`, …)``.

### 5.1 Why not `CONCURRENTLY`

`CLAUDE.md` warns that a hand-written `CREATE INDEX` on a hot table holds a ShareLock for the
whole build and prefers `CONCURRENTLY`. That guidance does not apply here, for two
independent reasons:

- `deploy.sh` stops the fleet **before** the migrate phase, so there are no concurrent
  writers to block.
- `CONCURRENTLY` cannot run inside a transaction, which would forfeit the roll-back property
  that makes the §5 precheck safe.

The tables are 122 and 8 rows.

## 6. Test plan

TDD. Every test below is written first and **proven red** against the unfixed code — for the
projector test, red in both of its failure modes.

**Load-bearing:**

1. **Projector, one row.** An event stream where the same player connects as `Sasha` and then
   `sasha` produces **one** `players` row carrying both sessions. Red today (two rows); red
   differently after the index alone (23505). This is the test that pins §3.1.
2. **Verifier, cross-case emote.** A link claimed as `sasha` verifies when the emote event
   arrives as `Sasha`. Red today — pins §3.2.
3. **Claim canonicalization.** Claiming `sasha` when the `players` row is `Sasha` stores
   **`Sasha`** on the link. This is the invariant §4 lets the 35 untouched `eq()` sites rely
   on.
4. **Claim conflict.** Claiming `sasha` while `Sasha` is verified by another user returns
   `409 already_verified`, not a 500.

**Supporting:**

5. Inserting `Sasha` then `sasha` into `players` violates the unique index.
6. Two `verified` links for `Sasha` and `sasha` violate the partial unique index.
7. `getVerifiedLinkId` sees a case-variant, so a competing claim is cancelled rather than
   colliding.
8. An unseen gamertag still returns `422 gamertag_not_seen`.
9. Re-claiming your own pending link in different casing stays idempotent — it must not
   report `409 active_link_exists` against itself.

## 7. Deploy

Plain `./deploy/deploy.sh`, **no `--rebuild`**. `0024` changes two indexes and no table
shape, and the audit found no collisions to collapse. No new env vars, workers, or systemd
units.

**Rollback:** if the precheck raises, the transaction rolls back with nothing changed. The
operator resolves the named collision by hand and re-runs.

## 8. Explicitly out of scope

- **The identity merge.** `players` remains keyed by gamertag, so a genuine *rename* (not a
  re-casing) still mints a second row. The same audit found 2 `dayz_id` values spanning 5
  gamertags — `daddyishome`/`tds maverick12` and
  `TidierCart8730`/`sombadyhalp`/`helpmeplz` — and all 122 players carry a non-null hash to
  merge on. That is a separate sub-project needing a migration and `--rebuild`.
- **Sweeping the 35 bare `eq()` comparisons.** Rejected with reasons in §4.
- **Rewriting `players.gamertag` to track casing changes.** Rejected with reasons in §4.1.
