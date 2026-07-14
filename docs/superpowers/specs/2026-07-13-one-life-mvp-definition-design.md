# One Life MVP — Definition & Decomposition

**Date:** 2026-07-13
**Type:** MVP scope definition (parent doc for a decomposed multi-sub-project build)
**Repo:** `one-life/` (fresh workflow-template project)
**Source:** `one-life-platform/` — read-only reference; code is ported piece by piece, never
edited in place. `../bot` is the behavioural reference for Nitrado ban mechanics. The RPT parser
detail lives in `2026-07-13-rpt-pipeline-spec.md` (Feature B only is in scope; see §7).

---

## 1. Context

- **Single tenant.** One community runs this; no multi-org isolation, no `tenant_id` plumbing.
- **Multiple servers.** Currently two Xbox servers, crossplay-enabled (console + PC players both
  connect). The design is per-server-aware throughout.
- **The product, in one line:** track every player's single life (birth → death across sessions),
  including the in-game character they wore; ban them for 24h when a qualified life dies; and let
  them earn their way back via verification and an unban-token economy.

## 2. The 18 requirements, mapped

| # | Requirement | Sub-project | Status |
|---|---|---|---|
| 1 | Single tenant | (cross-cutting) | design assumption |
| 2 | Multiple servers | SP1 | port |
| 3 | Track players across servers *(device id ✗)* | SP1 (players) | port; device-id clause **cut** — no signal on 1.29 (§6) |
| 4 | Track lives birth→death, actual playtime | SP1 | port |
| 5 | Track each life's in-game character | SP5 | new — signals confirmed present (§6) |
| 6 | Ban alt accounts | Nitrado built-in MAM (config) | **not code** — device signal removed in 1.29 (§6) |
| 7 | 24h ban when a qualified life dies | SP3 | new |
| 8 | Qualify lives (>5min OR PVP action) | SP1 (read model) + SP3 | port + new |
| 9 | Basic web front end | SP2 | port (slim) |
| 10 | Login via Discord/GitHub/Google/magic link | SP2 | port |
| 11 | Link a gamertag (unverified) | SP2 | port |
| 12 | Verify players via emotes | SP2 | port |
| 13 | Issue unban token on verification | SP4 | new |
| 14 | Issue unban token to all verified on the 1st | SP4 | new |
| 15 | Set a referrer (another verified player) | SP4 | new |
| 16 | Issue unban token per referral on the 1st | SP4 | new |
| 17 | Self-unban with a token | SP4 | new |
| 18 | Transfer tokens between verified players | SP4 | new |

*Cut vs. an earlier draft: device-based alt detection (RPT Feature A) and its admin override
("item 19") — the `[MAM]` device signal was removed from DayZ in 1.29 (§6). Alt handling falls back
to Nitrado's built-in Multi-Account Mitigation, left enabled.*

## 3. Scope decisions (locked)

- **Bans are per-server.** A qualified death on Chernarus bans only Chernarus; Sakhal is untouched.
- **24h death-bans only** (there is no custom alt-ban system — see below). Death-bans auto-expire.
- **Tokens lift only 24h death-bans.** A token skips the 24h wait. (There is no other ban type in
  code to lift.)
- **Token sources (all in MVP):** (a) first-time gamertag verification, (b) monthly grant to every
  verified player on the 1st, (c) monthly grant per confirmed referral on the 1st. Tokens are
  **transferable** between verified players.
- **Alt accounts are handled by Nitrado's built-in Multi-Account Mitigation, left ENABLED.** DayZ
  removed the `[MAM]` device-hash log lines in 1.29 (§6), so the deterministic device signal a
  custom detector would need no longer exists. We accept Nitrado's blunt built-in blocking (no
  exemptions for legitimately shared consoles, no visibility, no admin control) as the only
  available defense. No custom alt detection, no enforcer, no R1/R2, no device/uid exemption tables.
- **Character mapping (item 5) is IN the MVP** as RPT Feature B — but display-only (life/player
  pages show the survivor model/name). Its former consumer (the news engine) is cut; it is
  sequenced last because nothing depends on it and it is the heaviest parser work (§4 SP5).
- **News/LLM stack is cut entirely** and never ported: `apps/generator`, `packages/newsroom`,
  `packages/openrouter`, the `articles` / `newsroom_state` tables, and the births/incident/dossier
  read-models and news web pages.

## 4. Sub-projects

Each gets its own spec → plan → implementation cycle. Ordering ships a coherent product first
(SP1→SP4: track lives, 24h death-ban, earn your way back); SP5 (character display) lands last.

### SP1 — Foundation + ADM ingest + lives  *(port)*
Monorepo skeleton (pnpm + turbo + TS/ESM, Postgres + Drizzle). Port `packages/{db,domain,nitrado,
adm-parser,event-log,projections,read-models,test-support}` and `apps/{ingest-worker,projector}`,
dropping all news read-models and the auth/verification/news schema tables. Delivers multi-server
log ingest → `events` → `players`/`lives`/`sessions`/`kills`/`hit_events` projections, real
(in-game) playtime, PVP-action tracking, and the **qualified-lives** read model (`>5min OR a PVP
action`).
**Delivers:** items 2, 3(players), 4, 8(qualification). **Depends on:** nothing.

### SP2 — Auth + web + gamertag verify  *(port, slimmed)*
Port `packages/{auth,verification}` and `apps/verifier`; slim `apps/{api,web}` to the non-news
surface. Better Auth (Discord/Google/GitHub + magic link), gamertag linking (unverified), emote
verification (`verification_challenges` + emote dictionary + verifier loop). Minimal web: login,
account/claim + emote sequence, and a player dashboard (ban status, token wallet — wired in SP3/SP4).
**Delivers:** items 9, 10, 11, 12. **Depends on:** SP1 (players/gamertags to link against).

### SP3 — Death-ban enforcement  *(new)*
Extend the `nitrado` client with ban-list read/write (ported from `../bot`; exact endpoint/format
confirmed first — see gates). New `bans` table + enforcer consumer: when a **qualified** life dies,
add a **per-server 24h** ban that auto-expires. The "one life" spine; works standalone (no token
needed — you just wait 24h).
**Delivers:** items 7, 8(enforcement). **Depends on:** SP1 (qualified-life death events).

### SP4 — Token economy  *(new)*
`unban_tokens` wallet + ledger, `referrals`, and a scheduled monthly-grant job. Issue a token on
first verification; monthly grant to all verified; monthly grant per confirmed referral; self-unban
(redeem a token to lift your active 24h death-ban); transfer tokens between verified players. Web
surfaces: wallet, redeem, set-referrer, transfer.
**Delivers:** items 13, 14, 15, 16, 17, 18. **Depends on:** SP2 (verified users), SP3 (bans to lift).

### SP5 — RPT ingest + character mapping  *(new — RPT Feature B only)*
Build the shared RPT ingest foundation (RPT poller beside the ADM poller, `rpt_files` bookkeeping,
pure `rpt-parser`, server-local timestamp + midnight-rollover + clock-offset handling, offset
resume across restarts) — but wired **only** to character mapping, not device/alt detection.
Feature B: the login-correlation state machine (`Create entity type 'Survivor…'`, head-asset
warnings, `Simulate networked player`, the `LOAD EXISTING`/`CREATE NEW CHAR` + `charID` blocks),
the survivor-class roster in `@onelife/domain`, `character_sightings` + `characters` tables, and the
`getLifeCharacter` read-model (gamertag + time-window join to `lives`). Consumer: life/player pages
render the character model/name. **No `device_uids`, `uid_observations`, enforcer, or R1/R2.**
**Delivers:** item 5. **Depends on:** SP1 only (RPT poller beside ADM poller; join to `lives`).
Sequenced last (display-only; heaviest parser work), but could move earlier if character names are
wanted sooner — its only dependency is SP1.

## 5. What ports vs. what's new

- **Ports (mostly mechanical):** SP1, SP2 — code exists and works in `one-life-platform`; the work
  is copy, trim news, re-wire the monorepo.
- **Net-new (needs real design):** SP3 (ban enforcement), SP4 (token economy), SP5 (RPT foundation +
  character correlation). The RPT pipeline spec (`2026-07-13-rpt-pipeline-spec.md`) covers SP5's
  parser and Feature B; **ignore its Part III / Feature A (device/alt) — that is cut.** SP3 and SP4
  have no prior spec.

## 6. Signal findings (resolved gates)

1. **Device / `[MAM]` signal — GONE (resolves the alt-detection question).** Seven live RPTs
   (v1.29, crossplay) contained **zero `[MAM]` lines** — only account UID (per-account, cannot
   catch alts), device *type* (`console`/`desktop`), and per-connection `dpnid`. `[MAM]`
   device-hash lines were removed from DayZ as of 1.29 and are not returning. Toggling Nitrado's
   `disableMultiAccountMitigation` did not surface them. **Conclusion:** no deterministic device
   signal exists → custom alt detection (RPT Feature A) is cut; leave Nitrado's built-in MAM enabled
   as the fallback (§3).
2. **Character signals — PRESENT (item 5 is a go).** The same seven RPTs contain
   `Create entity type 'Survivor…'` (8), head-asset warnings incl. `_2` variants,
   `Simulate networked player entity Survivor…` (1,655), `charID` (442), `LOAD EXISTING CHAR` (7),
   and **`CREATE NEW CHAR` (5)** — the latter clears the RPT spec's open "fresh-spawn block literal"
   gate empirically. Character mapping needs no further gate.

**Still open — one gate remains:**

3. **Nitrado ban mechanics (blocks SP3).** Confirm the exact ban-list endpoint/format from `../bot`
   before building the enforcer.

## 7. Build order

`SP1 → SP2 → SP3 → SP4 → SP5`. After SP4 the product is complete and coherent (track lives, 24h
death-ban, earn your way back). SP5 (RPT + character display) lands last since nothing depends on it
and it is the heaviest parser work; it may be pulled earlier if character names are wanted sooner.
