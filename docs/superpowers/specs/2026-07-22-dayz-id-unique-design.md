# Promote `players.dayz_id` to unique (migration `0026`) — design

**Date:** 2026-07-22
**Status:** approved, not yet implemented
**Deploy:** plain `./deploy/deploy.sh`, **no `--rebuild`**

## 1. Why

This is **release two of two** for the identity merge
(`docs/superpowers/specs/2026-07-22-identity-merge-design.md` §7). Release one (`0025`, shipped
in v0.42.2) made `players.dayz_id` the identity and re-folded the event log so a rename resolves
to one player. It could **not** make `dayz_id` unique in the same release, because `deploy.sh`
migrates before it rebuilds, so the duplicate hashes still existed at migrate time.

The rebuild has now run in production and collapsed them. Verified on the live database after the
v0.42.2 deploy:

```
SELECT dayz_id, count(*) FROM players GROUP BY 1 HAVING count(*) > 1;   -- (0 rows)
```

The audit's two split accounts are now single identities, each with its full name history in
`player_gamertags`. So the constraint can now move from "upheld by the fold" to "enforced by the
schema."

## 2. What changes

**Migration `0026`** — hand-written SQL with a hand-appended `meta/_journal.json` entry
(`when: 1785600000000`, unique and after `0025`'s `1785500000000`; the drizzle snapshot chain is
broken, so `drizzle-kit generate` must not be used — follow `0018`–`0025`). Three statements:

1. A precheck `DO` block that raises, naming any `dayz_id` held by more than one `players` row.
   It is expected to pass. It exists because a bare `CREATE UNIQUE INDEX` aborts at the *first*
   duplicate, whereas this names them all at once — and it matches the `0024`/`0025` precheck
   pattern.
2. `DROP INDEX players_dayz_id_idx` — the **non-unique** lookup index `0025` created.
3. `CREATE UNIQUE INDEX players_dayz_id_uniq ON players (dayz_id)`.

The unique index serves `getPlayerByDayzId`'s `eq(players.dayzId, …)` lookup exactly as the
non-unique one did, so dropping the old index loses no query coverage — this is a swap, not an
addition. Plain (non-`CONCURRENTLY`) build: the table is ~120 rows and `deploy.sh` stops the
fleet before the migrate phase, so there are no concurrent writers; `CONCURRENTLY` also cannot run
in a transaction, which would forfeit the precheck's roll-back.

**`packages/db/src/schema.ts`** — the `players` index block changes
`byDayzId: index("players_dayz_id_idx").on(t.dayzId)` to
`uniqDayzId: uniqueIndex("players_dayz_id_uniq").on(t.dayzId)`.

## 3. What deliberately does NOT change

**`players.dayz_id` stays nullable.** Postgres unique indexes are nulls-distinct by default, so
the theoretical null rows the fold's `dayzId != null ? … : null` guard permits (never observed —
0/122 in the audit) are allowed and do not collide. The invariant being enforced is *one row per
known hash*, which a nullable unique index gives. Making the column `NOT NULL` would require
removing that guard and proving no path ever inserts null — more surface, hardening a case that
has never occurred. Out of scope.

**`createPlayer` stays a plain `INSERT` (no `ON CONFLICT`).** The unique index is now a
**backstop**: `onConnected` resolves by `dayz_id` before ever calling `createPlayer`, and the
projector is single-instance with a transactional fold, so it cannot race itself into a duplicate.
Should a race ever occur, the unique index makes the second insert fail loudly rather than
duplicate. Adding `ON CONFLICT (dayz_id) DO UPDATE … RETURNING` would reintroduce exactly the
silent-attribution hazard `0025` removed when it dropped the gamertag `ON CONFLICT` — so it is not
added.

## 4. Testing

Every test proven red before its fix, following `0024`/`0025`.

1. **Two players with the same `dayz_id` violate `players_dayz_id_uniq`** — the invariant, red
   against the pre-`0026` non-unique index.
2. **Two players with a NULL `dayz_id` are still allowed** — pins the nulls-distinct policy chosen
   in §3, so a future "tidy" to `NULLS NOT DISTINCT` or `NOT NULL` fails a test.
3. **`getPlayerByDayzId` still resolves a player by hash** — confirms the unique index serves the
   lookup the dropped non-unique index served (a behavioural check, not a new query).

## 5. Deploy

Plain `./deploy/deploy.sh`, **no `--rebuild`** — `0026` adds no projection table and changes no
projection-table shape, only an index on the existing `players` table. There is therefore none of
the rebuild-before-migrate ordering hazard that broke v0.42.1: the migrate phase creates the
index against a table that already exists.

If the precheck raises, the transaction rolls back with nothing changed — resolve the named
duplicate by hand and re-run. (Not expected; production is confirmed clean.)

No new env vars, workers, or systemd units. This completes the identity-merge sequence.
