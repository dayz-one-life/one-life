# SP5 — RPT Ingest + Character Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attach the actual in-game survivor character (`SurvivorF_Helga` → "Helga") to each life (item 5), by ingesting the DayZ **RPT** log alongside the ADM log. Feature B only — device/alt detection (Feature A) is permanently cut.

**Architecture:** A pure `@onelife/rpt-parser` runs a login-correlation state machine over RPT lines and emits **character sightings** (uid, gamertag, charId, class). The existing `ingest-worker` gains an RPT poll pass (mirroring its ADM pass) that feeds lines through the parser and writes `character_sightings` + a `characters` rollup. A `getLifeCharacter` read-model joins sightings to a life by gamertag + time window; the API life-detail response gains a `character` field. Class resolution uses model signals (a) `Create entity type` and (b) head-asset warnings, plus **charID inheritance** at the rollup (a reconnect with no signal inherits the class of any sighting sharing its charId). Fallback (c) entity-sim attribution is **out of MVP scope** (the parser must not require it; charId is always exact).

**Tech Stack:** TS ESM, Drizzle, vitest — same workspace. Real RPT files at repo root are the fixture source.

## Global Constraints

- **DEST:** branch `feature/sp5-rpt-character-mapping` (off `develop`). Local Postgres host **5434**.
- **Console (Xbox) RPT only.** All RPT-derived tables are durable side-tables — never truncated by `projector rebuild`; nothing here references projection row ids.
- **Nothing writes to `events`** — the ADM ingest keeps its single-writer invariant.
- **Ban identifier / life identity** joins are by **gamertag + time window** (the `lives`/`players` projections are gamertag-keyed).
- Web display is **deferred** with the stats dashboard (SP2 scope); SP5 delivers data + read-model + an API `character` field.
- Commit per task; same trailers.

## Real-line facts (from the live 1.29 logs — build regexes against these)

- Header: `Current time:  2026/07/11 11:38:05` (two spaces; `YYYY/MM/DD HH:MM:SS`). `Version 1.29.163047`.
- Per-line time `HH:MM:SS.frac` where **frac is variable width** (`.14`, `.195`, `.15`) — parse the fractional part as a decimal fraction of a second.
- Pending-login opens at `[StateMachine]: Player <NAME> (dpnid <D> uid <U>) Entering GetNewCharLoginState` **or** `... Entering GetLoadedCharLoginState` (uid is populated by then). Name may contain spaces → capture `Player (.+?) \(dpnid `.
- Model signal (a): `WORLD        : Create entity type 'Survivor[MF]_<Name>'` (leading space; only `Survivor[MF]_` classes count — AI `ZmbM_`/`Animal_` do not).
- Model signal (b): `Warning: No components in dz\characters\heads\<head>.p3d:geometry`.
- Connect: `Player <NAME> (id=<UID> pos=<X, Y, Z>) has connected.` (trailing period).
- Char block: literal `<LOAD EXISTING CHAR>:` or `<CREATE NEW CHAR>:`, then **4-space-indented** `charID <n>`, `playerID <n>`, `dpnid <n>`, `uid <U>`.
- Sim (recurring, MVP-unused): `NETWORK      : Simulate networked player entity Survivor[MF]_<Name>:<entityId>`.
- Roster = 31 heads (11 F, 20 M) incl. `_2` variants; class name = capitalized head basename minus `m_`/`f_` prefix minus `_2` (`f_linda_2` → `SurvivorF_Linda`, `m_niki_2` → `SurvivorM_Niki`).

---

### Task 1: Character roster in `@onelife/domain`

**Files:** `packages/domain/src/characters.ts` (+ export from `index.ts`), `packages/domain/test/characters.test.ts`.

```ts
export type SurvivorClass = { class: string; name: string; gender: "female" | "male"; head: string };
export const SURVIVOR_ROSTER: SurvivorClass[];              // 31 entries
export function classFromHead(head: string): string | null; // "f_linda_2" -> "SurvivorF_Linda"
export function rosterByClass(cls: string): SurvivorClass | null;
```
Build the 31 entries from the head list (F: baty, eva_2, frida_2, gabi_2, helga, irena_2, judy, keiko, linda_2, maria_2, naomi; M: adam, boris, cyril, denis_2, elias, francis, guo, hassan, indar, jose, kaito, lewis, manua, niki_2, oliver, peter, quinn, rolf, seth, taiki). Unknown classes/heads → null (forward-compat).

- [ ] Test: `classFromHead("f_linda_2") === "SurvivorF_Linda"`, `classFromHead("m_niki_2") === "SurvivorM_Niki"`, unknown → null; `rosterByClass("SurvivorF_Helga")` → `{name:"Helga", gender:"female", head:"f_helga"}`; roster has 31 entries.
- [ ] RED → implement → GREEN. Commit: `feat(domain): survivor character roster + head→class map`

---

### Task 2: Schema — `rpt_files`, `character_sightings`, `characters` (migration `0004`)

**Files:** `packages/db/src/schema.ts` (+3 tables), `test-support` `APP_TABLES`, migration `0004`.

```ts
export const rptFiles = pgTable("rpt_files", { /* mirror adm_files: id, serverId→servers, path, name,
  logDate, lastProcessedLine default 0, isComplete default false, lastPulledAt; UNIQUE(serverId, path) */ });
export const characterSightings = pgTable("character_sightings", { /* id, serverId→servers, rptFileId→rptFiles,
  lineIndex, uid, gamertag, charId bigint, playerDbId bigint null, kind text, characterClass text null,
  classSource text null, x/y/z double null, observedAt tstz; UNIQUE(serverId, rptFileId, lineIndex) */ });
export const characters = pgTable("characters", { /* id, serverId→servers, charId bigint, uid, characterClass null,
  firstSeenAt tstz, lastSeenAt tstz; UNIQUE(serverId, charId, firstSeenAt) — NOT unique on (serverId,charId): wipe caveat */ });
```

- [ ] Append tables; add names to `APP_TABLES`; `db typecheck`; generate `0004` (only the 3 tables); apply. Commit: `feat(db): add rpt_files + character_sightings + characters + migration`

---

### Task 3: Nitrado `listRptFiles`

**Files:** `packages/nitrado/src/client.ts` (add `listRptFiles`), `test`.

`listRptFiles()` mirrors `listAdmFiles()` but filters `.RPT` (same `config` dir listing). Extract a shared internal lister parameterized by extension.

- [ ] Test (fake fetch): returns `.RPT` entries with paths, sorted. Commit: `feat(nitrado): list RPT files`

---

### Task 4: `@onelife/rpt-parser` (the correlation state machine)

**Files:** `packages/rpt-parser/{package.json,tsconfig.json,vitest.config.ts}`, `src/{index,timestamps,lines,parse.ts}`, `test/{timestamps,parse}.test.ts`, `test/fixtures/*.RPT` (real excerpts copied from the repo-root logs). Deps: `@onelife/domain`. Pure — no db/nitrado/fs.

**Interfaces:**
```ts
export type CharacterSighting = {
  lineIndex: number; uid: string; gamertag: string; charId: number; playerDbId: number | null;
  kind: "existing" | "new"; characterClass: string | null;
  classSource: "create_entity" | "head_asset" | null;
  x: number | null; y: number | null; z: number | null; observedAt: Date;
};
export function headerDate(content: string): Date | null;      // from "Current time:  YYYY/MM/DD HH:MM:SS"
export function parseRptFile(content: string, opts: { offsetMs: number }): CharacterSighting[];
```

**State machine (per file):** maintain `pendingLogins: Map<dpnid, {gamertag, uid, dpnid, characterClass, classSource, openedLine}>`.
1. On `Entering GetNewCharLoginState|GetLoadedCharLoginState` → open/refresh pending login (key dpnid; capture gamertag, uid).
2. On `Create entity type 'Survivor[MF]_X'` OR a resolvable head warning → if exactly ONE pending login open, set its class (`classSource` = create_entity | head_asset); if >1 open, abstain (leave null).
3. On `Player NAME (id=UID pos=<x, y, z>) has connected.` → stash `lastConnect = {uid, pos}`.
4. On `<LOAD EXISTING CHAR>:` / `<CREATE NEW CHAR>:` → begin a char block (`kind`); read the next indented `charID/playerID/dpnid/uid` lines; when complete, match the pending login by dpnid (fallback uid), emit a `CharacterSighting` (class from the pending login, pos from lastConnect, observedAt = the block's timestamp), delete the pending login.
5. Timeout: drop pending logins with no connect within 120 s (by timestamp).
- AI `Create entity` (`ZmbM_`, `Animal_`) and survivor creates with no pending login are ignored.

**Timestamps:** `headerDate` gives the base calendar date; each line's `HH:MM:SS.frac` combines with it; a backward jump ≥20 h ⇒ day += 1 (midnight rollover); `observedAt` = that server-local instant shifted by `offsetMs` to UTC (mirror `adm-parser`'s clock-offset direction).

- [ ] Timestamp tests: header parse; a normal line; midnight rollover; offset applied.
- [ ] Parse tests (against real fixtures): the fresh-spawn login (`SurvivorF_Linda` + `<CREATE NEW CHAR>` charID 1, kind "new", class resolved from create_entity); the existing-char login (`SurvivorM_Cyril` + `<LOAD EXISTING CHAR>` charID 3, kind "existing"); a login whose class resolves only via the head warning; an AI `Create entity` outside any login (no sighting); two overlapping pending logins (class abstained → null, charId still emitted); a login that never connects (timeout → nothing).
- [ ] RED → implement → GREEN. Commit: `feat(rpt-parser): login-correlation state machine + character sightings`

---

### Task 5: RPT ingest pass in `ingest-worker` + `characters` rollup

**Files:** `apps/ingest-worker/src/{rpt-tick.ts,rpt-process-file.ts,config.ts,main.ts}`, `apps/ingest-worker/src/characters-store.ts`, tests. Add deps `@onelife/rpt-parser`.

- `rpt-process-file.ts`: given a server + rpt file content, run `parseRptFile`, insert `character_sightings` (idempotent on `(serverId, rptFileId, lineIndex)`), and **upsert the `characters` rollup**: match the `(serverId, charId)` row whose `lastSeenAt` is within `CHAR_STALE_HOURS` (default 72) of the sighting **and** `uid` matches; else insert a new epoch row. Backfill `characterClass` on the rollup when any sighting resolves it (inheritance).
- `rpt-tick.ts`: list RPT files (Nitrado), resume by `rpt_files.lastProcessedLine`, process new lines. Mirror the ADM tick's file-rotation/offset handling.
- `main.ts`: run the RPT tick beside the ADM tick each interval (same `NitradoClient`, per server).
- config: reuse `INGEST_INTERVAL_SECONDS`; add `CHAR_STALE_HOURS` (default 72).

- [ ] Test (test DB + a fixture RPT string): process → `character_sightings` rows written, `characters` rollup upserted with the class; re-process is idempotent (no dup sightings); a later sighting of the same charId with no class inherits the earlier class in the rollup.
- [ ] RED → implement → GREEN. Commit: `feat(ingest-worker): RPT poll pass → character sightings + rollup`

---

### Task 6: `getLifeCharacter` read-model + API field

**Files:** `packages/read-models/src/character.ts` (+ index export) + test; extend the life-detail response in `apps/api/src/routes/player-aggregate.ts` (and the read-model `getLifeDetail`) with `character`.

```ts
export type LifeCharacter = { charId: number; characterClass: string | null; name: string | null; gender: string | null; sightings: number; confidence: "exact" | "ambiguous" };
export function getLifeCharacter(db, serverId, gamertag, startedAt, endedAt): Promise<LifeCharacter | null>;
```
Match `character_sightings` by `serverId` + `gamertag` + `observedAt ∈ [startedAt − SLACK, (endedAt ?? now) + SLACK]` (SLACK default 5 min). Distinct charId: one → exact (class from `characters` rollup, name/gender from roster); zero → null; >1 → most-sighted charId, `confidence:"ambiguous"`.

- [ ] Test: exact / zero / ambiguous; SLACK at life edges; rebuild-safety (result is stable across a `projector rebuild` since it never uses `lives.id`).
- [ ] Extend the API life-detail with `character: LifeCharacter | null`; add a route test asserting the field is present.
- [ ] RED → implement → GREEN. Commit: `feat(read-models,api): resolve a life's character + life-detail field`

---

### Task 7: Verify + docs

- [ ] `pnpm turbo run typecheck` + `test --concurrency=1` → all PASS.
- [ ] `.env.example`: `CHAR_STALE_HOURS=72`. `CHANGELOG.md` (Added: SP5). `CLAUDE.md` (SP5 ✅; add `rpt-parser` + the 3 tables; note web display deferred).
- [ ] Commit: `test: verify SP5 + docs`. Branch ready for the PR-into-develop flow.

---

## Self-Review

- **Coverage (item 5):** roster (Task 1) + parser (Task 4) + ingest (Task 5) + read-model/API (Task 6) capture and expose the character per life. Web display deferred by design (SP2 scope).
- **Durability:** RPT tables are side-tables keyed on natural ids; the read-model joins by gamertag + window, never `lives.id` → rebuild-safe.
- **Scope discipline:** Feature A (device/alt) excluded; fallback (c) excluded (parser must not require it; charId always exact, class via a/b + rollup inheritance).
- **Placeholder scan:** exact regex anchors, literals, the roster, and idempotency keys are all concrete from the real logs.
