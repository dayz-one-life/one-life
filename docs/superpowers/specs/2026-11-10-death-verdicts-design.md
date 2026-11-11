# Death verdicts

Date: 2026-11-10 (written up for the repository on 2026-11-11, after the work was built).
Status: built in ten steps (PRs #396 to #407 and the cleanup that adds this note). The working
spec, plan and reviews stay in a private research folder: they quote real players, log lines and
per-death tables, and this repository is public. **Every name in this note is invented.**

## Why

A DayZ server log rarely says "player X died of Y" in one line. A death is one to several lines
(a kill line, a bare `died.`, a suicide line, a knock-out, a respawn), and the cause has to be read
off them and the lines around them. The site used to do that at read time, in a small ladder in
`@onelife/domain`, from the coarse word the parser stored and a 120 s window of hits. It printed
"Unknown" for deaths the log states plainly, called an unconscious respawn a mauling, and gave every
surface (life page, cards, Rap Sheet, OG images, obituary prompt) its own copy of the wording.

The motivating death, "the tripwire case": a player walked into a tripwire rigged with a frag
grenade. The log says so (a trip line four seconds before an explosion kill line). The page said
"Explosion", the obituary said the cause was unknown, and nobody got the kill.

## Goals

1. Every ended life gets **one stored verdict**: a precise internal cause, a certainty
   (`definitive | strong | inferred | unknown`), the object involved, the upstream cause where
   there is one, and the evidence lines.
2. The verdict is **derived from `raw_lines`**, so it can be re-derived at any time: after a
   classifier change (a version bump), after a `--rebuild`, for all of history.
3. **Every public surface prints the same server-computed wording.** No client rebuilds a label
   from tokens.
4. **Honest hedging on every string.** A stated cause is printed as fact; a strong cause carries a
   caption; an inferred cause reads "Likely …", carries its family tag, and is narrated in prose
   only as a reading. A missing verdict is "Awaiting the record", never "Unknown".
5. The TypeScript classifier matches a reviewed reference answer on every real death **before**
   any reader or the newsdesk uses it (the golden gate, below).
6. **Bans and the victim's qualification do not move** because of the classifier's reading of how
   someone died. Victim-side qualification still reads `lives.death_cause = 'pvp'` only. The one
   decided exception runs the other way: a trap kill is a kill for the player who set the trap.
7. **Nothing internal reaches a public page, the API, the writer or this repository**: the logout
   marker, an inferred shooter, a captor, a placer who did not pass the credit bar, rule ids,
   evidence, HP numbers, raw class names.

Non-goals: naming anyone the log does not name; a public "logged out" label; patching historical
events or appending events; new event kinds or `lives` columns; editing posts already sent to
Discord or Facebook.

## Taxonomy

The classifier stores a research token (the internal cause) verbatim; `@onelife/death-verdict`'s
vocabulary turns (cause, certainty) into every public string at once: label, detail, sentence,
caption, tag and the obituary writer's line. No string exists at one certainty only.

**Hedging by certainty**

| Certainty | Card, OG image, Morgue, ban card | Life page and Rap Sheet | Tag | Obituary prose |
|---|---|---|---|---|
| definitive | bare label ("Tripwire") | sentence, as fact | family tag | stated plainly |
| strong | bare label | sentence + "Worked out from the log" | family tag | stated, one qualifier allowed |
| inferred | "Likely starvation" | "Likely …" sentence + "Best reading of the log. The server recorded no cause." | family tag | a reading, hedged in every sentence that states it; never in the headline or pull quote |
| unknown | "Not recorded" | "The log does not say." | Unknown | nothing about the mechanism |
| withheld | "No cause given" | "No cause is given for this death." | Unknown | the life, nothing about how it ended |
| pending | the stated coarse word ("Killed by NAME", "Suicide", "Explosion"), else "Awaiting the record" | same | none | no obituary yet |

The object (grenade type, vehicle) is printed only at definitive or strong.

**Internal cause to public label** (abridged; the vocabulary in
`packages/death-verdict/src/vocabulary.ts` is the full table, and a test requires a row for every
(cause, certainty))

| Internal causes | Label | Tag |
|---|---|---|
| `pvp` with a kill line naming a player | Killed by NAME | PvP |
| `pvp` with no kill line | Killed / Likely killed | PvP |
| `pvp` with an ownerless firearm on the kill line | Shot | Gunfire |
| `explosive_held_grenade` | Killed by NAME | PvP |
| `suicide`, `self_inflicted` | Suicide (with conditions) / Self-inflicted | Self-Inflicted |
| `explosive_trap`, `landmine` | Tripwire / Land mine | Trap |
| `explosive_grenade`, `explosive_40mm`, `explosive_charge`, `explosive_claymore`, `explosive_other`, `self_inflicted_explosive`, `fuel_explosion` | Grenade / Explosion / Own explosive / Fuel pump explosion | Explosion |
| `fire` | Burned | Fire |
| `infected` | Infected / Likely infected | Infected |
| `animal_wolf`, `animal_bear`, `animal_dog` | Wolf / Bear / Dog | Wildlife |
| `fall`, `drowned` | Fell / Drowned | Fall / Drowned |
| `vehicle_run_over`, `vehicle_impact`, `vehicle_own_crash`, `vehicle_crash_occupant` | Hit by a vehicle / Motorbike crash / Vehicle crash | Vehicle |
| `bled_out_*`, `pvp_bleedout` | Bled out | Blood Loss |
| `starvation`, `dehydration`, `starvation_and_dehydration` | Starvation / Dehydration / Starvation and thirst | Hunger and Thirst |
| `cold_exposure`, `heatstroke`, `heatstroke_or_silicosis` | Exposure | Exposure |
| `pneumonia` | Illness | Illness |
| `respawn_while_unconscious`, `unconscious_logout`, `logout_under_attack` | the upstream cause's label, capped at strong ("Died after an infected attack.") | as the upstream |
| `restrained_logout`; a logout death with no publishable upstream | No cause given | Unknown |
| `unknown` | Not recorded | Unknown |

Rules that hold for every row:

- **The logout family never says "logged out".** It prints what put the player down, and avoids
  the verb "killed": the server, not the attacker, ended an unconscious body.
- **Inferred labels stay at family level.** "Pneumonia", "silicosis" and "heatstroke" are never
  public. Each inferred family has a switch (`PUBLIC_INFERRED`); off, its label, sentence, caption
  and tag read "Not recorded" / "Unknown" everywhere at once, live and frozen alike. An inferred
  cause with no family (a fall, wildlife) is never shown.
- **"Own" is printed only when the kill line names the victim.** A device or fire inferred from
  proximity stays internal.
- **A driver is never "Killed by".** A named driver appears on the life page only, as plain text.
- **Priors** ("usual cause of death") count definitive and strong verdicts only, on the tag.
- **Legacy fields.** Every public death also carries `cause` / `confidence` in the pre-stage-4
  vocabulary (`legacyCause`), so an old reader prints something correct and hedged. Old articles'
  `cause` and `facts.verdict` keep that vocabulary permanently. The client's token branches
  (`verdictPhrase`, `VERDICT_NOUN`, `ENTITY_VERDICTS`) stay until the mobile minimum-version floor
  (`GET /api/app-version`) is raised past the last build that reads them.

## Data model

`packages/death-verdict` (`@onelife/death-verdict`) is pure: no database, no workspace
dependencies. It holds the evidence parser, the log clock, the death cluster, the context
selection, the classifier and the vocabulary. `read-models`, `projector`, `newsdesk` and `api`
import it; `client-logic` and `apps/web` cannot, which is why every string is made on the server.

Migration `0040_death_verdicts.sql` (additive):

- **`death_verdicts`**, one row per ended life (`life_id` primary key, cascades from `lives`):
  `classifier_version`, `source` (`classifier | override`), `settled_by`, the resolved primary
  death line (`death_file_id`, `death_line_index`), `death_at` (log clock), `cause`, `confidence`,
  `mechanism_stated`, the object, the upstream cause, co-causes, public-safe `conditions`, the
  attribution (role, basis, id, gamertag, confidence; internal), `rule`, `evidence` (internal
  jsonb), `needs_review`, `override_seen_at`.
- **`death_verdict_queue`**: lives the sweep has seen but not written, with attempts, the last error
  and a backoff.
- **`death_verdict_overrides`** (durable, never truncated): the operator's corrections, keyed on
  the death line, which is stable across rebuilds (`adm_files` and `raw_lines` are never truncated).
  Null columns keep the classifier's value. `credit` is `deny` or `grant`.
- **`kills` gains `basis`** (`kill_line | trap_placement`) and `credit_source`
  (`classifier | override`, null for a kill line), with a check constraint tying them together.

Why a side table and not `lives` columns: three public routes serialise whole `lives` rows, so an
internal column there would be public JSON the day it lands. Why not in `REBUILD_TRUNCATE_TABLES`:
`TRUNCATE lives … CASCADE` already empties both verdict tables, and `kills` is already listed.

Later additive migrations: `0041` (`articles.verdict_version`), `0042` (`article_revisions`) and
`0043` (`bans.lift_reason`).

## How a verdict is made

- **Log clock.** Times are rebuilt from each file's header date, the line prefix, midnight rollover
  and a per-server zone rule, not from the stored `occurred_at`, which is skewed on some files.
- **The cluster.** Any line of a death is a valid seed; `resolveCluster` walks the victim's lines
  around it and picks the primary by the reference rule (the first `killed`, `died` or `drowned`
  line, a `killed by` line preferred; never a `committed suicide` line). The stored line, the
  override key and the golden join all use this resolved primary.
- **The context.** `selectContextLines` is the one definition of what is loaded: the victim's whole
  life, the cluster and five minutes after, the whole server ten minutes either side, company along
  the life, lines that mention the victim, nearby placements, the credit ring around a trap, and
  earlier deaths. A private test classifies every real death from the trimmed selection and from
  the whole corpus and requires identical answers.
- **The rules.** The reference ladder is ported in its order, first match wins: rules A01 to A17 for
  a `killed by` primary, B01 to B08 for stated bare deaths, then the inferred rules (B09 to B23),
  then a post-pass for assists, contributors and co-causes. A stated line always wins. Only a kill
  line makes a killer on the victim's record. The classifier never reads `lives.death_cause`.
- **The golden gate.** A private repository holds the reference answers for every real death and the
  corpus they come from. `pnpm --filter @onelife/death-verdict run golden` runs the private suites
  and, only when every suite passed with nothing skipped, writes `golden-attest.json`: hashes of the
  source, the harness and the private inputs, the counts, and an Ed25519 signature. A public test
  checks the attestation against the code in the PR, so a change to the classifier, its scripts or
  its private tests cannot pass CI without a fresh signed run. `CLASSIFIER_VERSION` is bumped with
  every change that can move an answer.

## The sweep

`apps/projector/src/verdict-sweep.ts`, called from the projector loop after each fold tick, in its
own try/catch. No new service.

- **Skipped while the fold is behind**, so a half-enriched life is never classified and a rebuild
  simply waits.
- **Targets**: ended lives with no row or a row at an older version, settled, not backing off;
  plus lives whose override changed (`updated_at` differs from `override_seen_at`, or the override
  is gone) and wall-settled rows whose file has since moved. Oldest death first.
- **Budget**: at most 10 s or 50 lives a pass; files are cached within a pass.
- **Settled** is judged from ingest progress in the death's own file: a line at least 300 s after
  the death, or a later file, or 30 minutes of wall clock since the sweep first saw the life. A
  wall-settled row gets one second look when its file catches up or after 24 hours.
- **Failures** never write a verdict: the queue row gets the error and a doubling backoff (30 s to
  6 h). A held life can be unblocked by an override with a cause and a confidence.
- **One transaction per life**: upsert the verdict, delete any `trap_placement` row for the victim
  life and, when the kill stands and the write switch is on, insert one; delete the queue row.
- **Invariant**: a kill-line attribution must agree with `lives.death_cause = 'pvp'`. A mismatch is
  stored with `needs_review = true`, presented as pending, logged at error level, and blocks the
  obituary until an override settles it.
- **A version bump rewrites rows in place**; readers keep serving the old row until then.

New deaths get their verdict about six minutes after they are folded. Obituaries are written only
from a stored, final verdict; an alarm logs any qualified death still without one after 45 minutes.

## A trap kill

A player whose placed tripwire or land mine kills another player **scores a kill, like any other
kill**: one number, "Kills", on every page and board, and the kill qualifies the placer's life that
is open at that moment. The log never says whose device fired, so the kill is always a reading of
where a trap was set. What keeps that honest is a marker on the kill, the wording, and the bar.

**Scope.** A tripwire with a frag grenade or a claymore, and a land mine. Plastic and improvised
explosives, a claymore with no trip line, bear traps, fireplaces and barbed wire are stored for
the operator only.

**The bar.** The *anchor* is the victim's position on their own trip line (for a mine, on the kill
line). *Candidates* are earlier placements of the same device class on the same server within
5 m of the anchor, matched by player id, and not older than a recorded world wipe. A trap kill is
written only when all seven tests hold:

| # | Where | Test |
|---|---|---|
| 1 | classifier | The cause is a tripwire or land mine at definitive or strong |
| 2 | classifier | Exactly one distinct placer among the candidates |
| 3 | classifier | No other player has an unspent same-class placement within 15 m of the anchor |
| 4 | classifier | The placer is not the victim |
| 5 | classifier | One of the placer's candidates is later than the most recent earlier detonation within 5 m of the anchor (placement lines are never counted; one device often writes several) |
| 6 | sweep | The placer resolves to a `players` row by id |
| 7 | sweep | The victim's life counts on its own: 300 s of play, or a kill-line kill in its window |

Test 7 has no exception: it guarantees every victim in `kills` has a public life, and it stops a
friend's mine being walked onto for free kills. An operator grant replaces tests 2, 3 and 5 only.
The outcome and the number of the refusing test are stored in `evidence.credit` (internal), with
flags for shapes nobody has measured (an ambiguous second trip, a non-four-second fuse, another
player's claymore nearby) that do not refuse but are listed for the operator.

**Why a marked row in `kills`.** A side table with a view over both kinds was considered and
rejected: every kill query would have had to move to the view, and one missed or future reader
would silently not count the kill, so the enforcer and a page could disagree about whether a life
qualified. With the row in `kills`, a reader that knows nothing about traps does the decided
thing. The row is `basis = 'trap_placement'`, `credit_source = 'classifier'` (or `'override'`),
the placer's player id and current gamertag, the victim's life, `occurred_at` = the victim's
`ended_at`, weapon "Tripwire" or "Land mine", and no distance (so no "longest kill" board shows
it). The victim's record is untouched: `death_cause` stays `explosion`, `death_by_gamertag` stays
empty, and dying to a trap does not qualify a short life. The fold never writes or touches a trap
row; the sweep never touches a kill-line row. The row carries the placer's name when it is
written, which can be after a rename; the readers that match kills to players by id (PR #398)
are not moved by that.

**Wording.** No string says the placer killed the victim as a logged fact, or calls it "their
tripwire". "Killed by NAME", "NAME's tripwire" and "confirmed kill" are never used for a trap row.

| Surface | Wording (Placer One set the wire, Victim One walked into it) |
|---|---|
| Cards, feed, Morgue, OG image, ban card | "Tripwire" · "M67 frag grenade" |
| Victim's life page and Rap Sheet | "Killed by a tripwire rigged with an M67 frag grenade. Kill credited to Placer One." Caption: "The log names no killer. Placer One placed the only tripwire it records at this spot." |
| A land mine | "Killed by a land mine. Kill credited to Placer One." |
| An operator grant | Caption: "The log names no killer. Credited by the server operator." |
| Placer's kill list and timeline | "Victim One · Tripwire · by trap", footnote "By trap: credited from where the trap was placed. The log names no killer." |
| The line where a trap kill qualified a life | "A trap kill credited. The life counts from here." |
| A renderer of `GET /servers/:id/kills` | "Victim One · killed by a tripwire · kill credited to Placer One" |
| Victim's obituary | the credit, in the body only, in fixed words |
| Placer's obituary | the kill counts, with a caveat line to the writer; no kill count in the headline or lede |

**The write switch.** `TRAP_KILLS_WRITE` (projector environment, default off). Off, the outcome is
stored in `evidence.credit` only and every pass deletes any trap row it finds; on, the next pass
writes the stored credits' rows. A kill is public the moment it is written, so the switch was
turned on only after the operator had read `verify-verdicts --credits`. Off is also the rollback:
one pass and every trap kill is gone.

**The enforcer.** A trap kill can arrive minutes, or (for a grant on an old death) weeks, after
the placer's life ended, and the enforcer rescans every ended, unbanned life each tick, so a late
ban is possible. Four changes make that safe:

1. `planBans(lives, hours, now)` skips a life whose ban would already have ended.
2. **The sibling check.** The server's ban list holds names, not bans, so two bans of one player
   share an entry. When a ban expires or is lifted, the enforcer removes only the names no other
   running ban for that server needs (`namesToRemove`: the ban's names minus those of other
   pending or applied bans sharing an id or gamertag). Without it a late ban's expiry would let
   the player back in while a later ban still says applied.
3. A token redeem lifts every active ban of that player on that server.
4. The "banned until" text is built from `expires_at`.

**Withdrawal.** A `deny` override deletes the row on the next pass and every live number corrects
itself. What was already materialised is withdrawn by command: `regenerate --denied-credit`
rewrites or retracts the obituaries that relied on the kill, and `unqualified-bans --lift` lifts a
ban whose life no longer qualifies (`lift_reason = 'operator'`; the notification says the operator
lifted it, not that a token was spent).

**Wipes.** Nothing in the log marks a world wipe. A wipe on a server that keeps its id must be
added to `WIPES[serverId]` (a version bump), or a trap set before it could be credited with a
death after it. `verify-verdicts --credits` warns when a credited placement predates a 72-hour
total silence or a map change.

## Obituaries

- **`obituary-v4`** writes from the stored verdict: a cause line chosen by certainty, a NOT
  CONFIRMED heading for an inferred cause, directives for withheld and unknown deaths, and a
  deterministic cause check after generation (no logout words, no flat statement of an inferred
  cause, no unhedged family word, no named placer outside the credit sentence, no kill count in the
  headline). A failed check retries once, then fails the article.
- Each article freezes its hedged strings (`facts.death`) and the verdict version it was written
  from. Readers serve the live final verdict, else the frozen strings, else the legacy fields.
- **`regenerate`** (`apps/newsdesk`) rewrites old articles in place after a correction, keeping the
  slug, status and syndication ledger, and archives the old text in `article_revisions`; the page
  then says "This obituary was rewritten on DATE after the cause of death was corrected."
  `--restore` puts the old text back. A retracted article blocks its life from being written again.

## Runbook

Every command below is run on the host after loading its environment. `verify-verdicts` prints
player names: read it there, never paste it anywhere public.

- **Something reads "Awaiting the record" for more than 30 minutes, or an obituary is late.**
  `pnpm --filter @onelife/projector run verify-verdicts -- --held` lists held and needs-review
  lives with the error and the override key of each death. Fix the classifier, or insert an
  override for that line.
- **You disagree with a verdict.** Insert a `death_verdict_overrides` row for the death's line
  (`server_id`, `death_file_id`, `death_line_index`, `cause`, `confidence`, `note`, `created_by`),
  taking the line from `death_verdicts` or, for a held life, from `--held`. The next pass rewrites
  the verdict with `source = 'override'`. Update or delete the row to change your mind.
  `verify-verdicts` reports a mistyped cause or an override that matches nothing.
- **A trap kill is wrong.** The same insert with `cause` and `confidence` null and
  `credit = 'deny'`. Once `--held` shows an empty queue:
  `pnpm --filter @onelife/newsdesk run regenerate -- --denied-credit` (dry run), read it, add
  `--write`; then `pnpm --filter @onelife/enforcer run unqualified-bans` and `--lift` if a ban rested
  on that kill. Delete by hand the social posts whose URLs the first command prints, and refund by
  hand any token spent on a lifted ban.
- **Turn every trap kill off.** `TRAP_KILLS_WRITE=false`, restart the projector, wait one pass,
  then the two commands above.
- **Credit a trap kill the rule refused.** `credit = 'grant'` with `credit_dayz_id` set to the
  placer's id. Run `verify-verdicts --credits` first: it shows why the rule refused and which of the
  placer's lives the kill would fall in, including whether it would newly qualify that life (and so
  create a ban and an obituary). A grant cannot pass tests 1, 4, 6 or 7.
- **A world wipe on a server that keeps its id.** Add it to `WIPES`, bump `CLASSIFIER_VERSION`, run
  the golden gate, deploy.
- **A classifier fix.** Run the golden gate, commit the attestation, bump the version, deploy, run
  `verify-verdicts --rederive`. Then look for stale prose: articles written from an older version
  whose public cause changed (`regenerate --stale-cause`).
- **A `--rebuild`.** Nothing extra: the sweep waits for the fold, then refills. Meanwhile pages
  show the coarse word and articles show their frozen values. Overrides survive.
- **A new server or map.** Add its zone to `SERVER_ZONES` and, once `verify-verdicts` shows its
  observed spawn levels, its `SPAWN_BASELINES` entry. Both are version bumps.
- **Turn an inferred family off.** Set its `PUBLIC_INFERRED` entry to false and deploy; labels,
  captions and tags change at once. Then `regenerate --inferred-family <family>` (dry run, then
  `--write`) rewrites the prose, and lists each article's URL so its social posts can be deleted by
  hand.

## Where things are

| What | Where |
|---|---|
| Classifier, vocabulary, presentation | `packages/death-verdict/src/` |
| Golden gate and attestation | `packages/death-verdict/scripts/`, `test/golden-private/`, `golden-attest.json` |
| Context loader, public death readers | `packages/read-models/src/death-context.ts`, `death-verdicts.ts`, `obituary-articles.ts` |
| Sweep and operator check | `apps/projector/src/verdict-sweep.ts`, `verify-verdicts.ts` |
| Obituary writer, cause check, regenerate | `apps/newsdesk/src/prompt.ts`, `cause-check.ts`, `regenerate.ts` |
| Enforcer changes | `apps/enforcer/src/decide.ts`, `tick.ts`, `unqualified-bans.ts` |
| Architecture notes | `docs/architecture/ingest-and-domain.md` (stage 4, the readers, newsdesk v4), `docs/architecture/web-surfaces.md` (deaths and trap kills on the page) |
