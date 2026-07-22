# Ban by player ID

**Date:** 2026-07-22
**Status:** Approved, not implemented
**Scope:** Close ban evasion by gamertag rename. One release, no projection rebuild.

## 1. What this builds

The enforcer bans a player's **DayZ player ID** — the stable account hash — instead of only
their gamertag. A player who renames mid-ban stays banned, because the thing on the ban list
no longer changes when the name does.

## 2. Why: the evidence

A production dump (`onelife-pre-v0.37.2-full.sql`, 2026-07-22 15:05) was restored and audited.

**Gamertags are not identities.** Two accounts have used five gamertags between them:

| `dayz_id` | gamertags | lives |
|---|---|---|
| `5FE23158…` | `tds maverick12`, `daddyishome` | 2 + 1 |
| `7B99B543…` | `TidierCart8730`, `helpmeplz`, `sombadyhalp` | 9 + 2 + 2 |

These are renames, not alt accounts, confirmed by two independent log sources: the ADM `id=`
hash is identical across the names, and the RPT logs show the same `uid` **and the same
`char_id`** — one account occupying one character slot. A second account on the same console
would necessarily have both a different `uid` and its own `char_id`. Sessions never overlap,
and position is continuous to the metre across each handoff (`TidierCart8730` disconnects at
`(12682.9, 6438.4)`; `helpmeplz` connects at `(12682.9, 6438.4)` four minutes later).

**A rename defeats the ban.** Nitrado's DayZ ban list is matched against the connecting player;
the enforcer writes gamertags into it (`addBan(b.gamertag)`). The audit found **22 connections
under a different name during an active ban window** by these two accounts. Those particular
bans were `dry_run = true`, so nothing was actually evaded and no intent can be inferred — but
enforcement went live on 2026-07-17 (16 real bans since, one active at dump time), so the
mechanism is live now. No rename has yet occurred during the live-ban era.

**The ID is available and complete.** `dayz_id` is present on 100% of players (122/122),
parsed from every `connecting` / `connected` / `disconnected` / `death` line. No gamertag maps
to two `dayz_id`s. Zero RPT sightings carry a `uid` absent from `players.dayz_id`, so ADM and
RPT share one identity space.

**Nitrado accepts it.** The Banlist field states *"Players (Player names or Player ID) listed
here are getting kicked and aren't able to join anymore."* Verified empirically against the
live Livonia server: the 40-character ADM `id=` hash was entered alone (no gamertag) and the
matching account was kicked on join.

## 3. The identity

`players.dayz_id` — a 40-character hex hash, e.g.
`7B99B5432AB4EE67349EDD866CC48B93A0BD72F6`, appearing in ADM as `id=`.

It is **frozen onto the ban row at creation**, not resolved at enforcement time. `bans` already
freezes `(server_id, gamertag, life_started_at)` as facts-at-ban-time, and the ID belongs to
that set. Resolving it later through a `players` join would break precisely when the deferred
identity work (§9) merges rows and a historical gamertag stops resolving to a row.

## 4. Schema

Migration `0023`: add `bans.dayz_id text` (nullable), and backfill from `players` by gamertag.

Nullable, because a `players` row may carry no `dayz_id` if it was only ever seen on lines that
omit one. Every current row has one, so the backfill is total, but the column must tolerate its
absence rather than the enforcer assuming it.

`bans` is durable — absent from `rebuild.ts`'s truncate list — so this is a plain
`./deploy/deploy.sh` with **no `--rebuild`**.

## 5. What goes on the ban list

**Both the ID and the gamertag.** The ID is load-bearing: it is what survives a rename. The
gamertag is belt-and-braces at the cost of one line in a text field — if ID matching ever
changes behaviour, name matching still catches the un-renamed case. A rename defeats the name
half while the ID half holds, so listing both is strictly better than either alone.

When `dayz_id` is null, the ban degrades to name-only — today's behaviour, not a regression.

## 6. Enforcer changes

`detect` (`findEndedUnbannedLives` → `planBans` → `insertBan`): select `players.dayz_id`
alongside the gamertag and carry it onto the inserted row. The ban's uniqueness key
(`bans_server_gamertag_life_uniq`) is unchanged — this release does not renumber or re-key
anything.

`apply` / `expire` / `lift`: each currently makes one `addBan`/`removeBan` call per ban. Each
of those is a **whole-field read-modify-write** of a single `\r\n`-joined string
(`packages/nitrado/src/client.ts`), so writing two entries per ban via the existing methods
would be two full GET+POST round trips and a lost-update window between them. Add batched
`addBans(names: string[])` / `removeBans(names: string[])` that perform **one** read-modify-write
for the whole set, and have all three arms pass `[dayzId, gamertag].filter(Boolean)`.

Removing an entry that is not present leaves the list unchanged, so `removeBans` is safe for
bans predating this change. `removeBans` should additionally **skip the POST entirely when
nothing changed** — today's `removeBan` writes the whole field back regardless, which for a
ban that predates this change means a pointless whole-field rewrite of the live ban list on
every expiry.

## 7. In-flight bans

A ban already `applied` when this deploys has only its gamertag on the list. The `apply` arm
reads `pendingBans`, so it will not revisit it, and its ID is never added — it stays name-only
until it expires, at which point `removeBans` clears both (the absent ID being a no-op).

This is accepted rather than fixed: the exposure is bounded by `BAN_DURATION_HOURS`, no rename
has occurred in the live-ban era, and a reconciliation pass over already-applied bans is more
moving parts than the window justifies. Operators wanting immediacy can clear the affected
server's Banlist after deploy; the expire arm tolerates the entries already being gone.

## 8. Testing

**Unit, pure:** `planBans` carries `dayzId` through; the name list is `[dayzId, gamertag]` with
both present, `[gamertag]` when `dayzId` is null, and never contains `null`/`""`.

**Against Postgres:** `detect` populates `bans.dayz_id` from the joined player; a player with a
null `dayz_id` still produces a ban.

**Against a fake Nitrado:** `apply` issues exactly **one** read-modify-write containing both
entries; `expire` and `lift` remove both; removing an absent entry is a no-op; a ban with a null
`dayz_id` writes only the gamertag. The fake asserts call *count*, not just contents — the
batching is the point, and a per-name implementation would pass a contents-only assertion.

**Migration:** the backfill populates `dayz_id` for existing bans whose gamertag matches a
player, and leaves it null otherwise.

**No-op write suppression:** `removeBans` with nothing to remove issues **zero** POSTs. Pinned
because the natural implementation (filter, then always write) passes every contents-based
assertion while rewriting the live ban list on every tick.

## 9. Out of scope

- **Merging the split identities.** Two players still render as five survivors with split
  stats, and priors will describe a 13-life veteran as a first-lifer. The fix is in the fold —
  `getPlayer(gamertag)` ignores the `dayzId` it already parses — and is retroactive via
  `--rebuild`, since `players`/`lives`/`sessions`/`kills` are all re-folded from the event log.
  It is a **data-quality** fix, not a security one, and ships separately.
- **A gamertag alias table**, per-tick alias reconciliation, and multi-alias ban writes. All of
  this existed to defeat rename evasion by banning every name an identity had used. Banning the
  ID makes it unnecessary; do not build it.
- **Extending a ban by 24h per rename detected during it.** Designed to punish an exploit that
  ID-banning removes. With the ID banned, renaming mid-ban achieves nothing, so the penalty
  could only ever fire on an innocent rename while providing no protection.
- **Gamertag case-sensitivity.** Audited across every gamertag-bearing table: zero case-variant
  duplicates, zero casing disagreement, despite 107 of 122 gamertags being mixed-case. Latent,
  and largely defused once identity is a hash rather than a string.

## 10. Rollout

Plain `./deploy/deploy.sh`, **no `--rebuild`** — migration `0023` touches no projection table.
No new env vars, worker, or systemd unit. The change is live on deploy: `ENFORCER_DRY_RUN` is
already `false` in production, so the next qualified death writes both entries.
