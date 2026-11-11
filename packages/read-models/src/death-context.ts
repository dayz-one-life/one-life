import { sql } from "drizzle-orm";
import type { Database } from "@onelife/db";
import {
  buildDeathContext, detachedIsAmbiguous, isKnownServer, orderFiles, parseEvidenceLine, selectContextLines,
  stampCorpus, stampDetached, stampLines, zoneForServer,
  type ContextInput, type DeathContext, type ExtraLine, type LogFile, type Pos, type ServerCorpus, type ZoneRule,
} from "@onelife/death-verdict";

/**
 * Loads what the death-verdict classifier needs for one ended life, from `raw_lines`.
 *
 * ⚠️ Everything is read from the log itself. The classifier never sees `events.payload.cause` or
 * `lives.death_cause`; the `player.died` event is used ONLY to find a line of the death (the seed),
 * and `resolveCluster` works out the real primary line from there. A firearm suicide is folded from
 * its `committed suicide` line; its primary is the `died.` line after it.
 *
 * ⚠️ `raw_lines.occurred_at` is not a clock: it is nullable and was stored skewed (900 s early in
 * two files, an hour early for days after a clock change). Line times come from the log clock in
 * `@onelife/death-verdict`; `occurred_at` is only ever a rough hint for a line read out of its file.
 *
 * The one selection rule is `selectContextLines`; this file only decides which files to hand it:
 * every file of the server from the previous death's file through the file after the death's file,
 * whole, plus the placement and detonation lines near the death from older files (traps outlive
 * restarts by weeks).
 */

/** A life the loader cannot read. The sweep records the message on the queue row and retries. */
export class LoadError extends Error {
  constructor(message: string) { super(message); this.name = "LoadError"; }
}

/** Files parsed within one sweep pass, by id, and each server's boot order. Pass one per pass. */
export interface FileCache {
  files: Map<number, LogFile>;
  boots: Map<number, ReadonlyMap<number, number>>;
}
export const newFileCache = (): FileCache => ({ files: new Map(), boots: new Map() });

/** A death is looked for at the life's end within this many seconds (the fold stamps `ended_at`
 *  from the event; a rebuild can move it by a second, spec 3.5). */
export const SEED_WINDOW_S = 2;
/** With no previous death, loading starts at the file holding `started_at` minus this ... */
export const FIRST_LIFE_LEAD_S = 2 * 3600;
/**
 * ... measured against `adm_files.log_date` with this much slack. ⚠️ `log_date` is the file's start
 * as the server's WALL CLOCK read it, stored as if it were UTC (a Pacific host's file is labelled
 * seven or eight hours early). Without the slack the first file of a life is skipped, the life
 * looks a day old instead of fresh, and the suicide wording changes. Any zone is within 14 hours.
 */
export const LOG_DATE_SLACK_S = 14 * 3600;
/** Placements and detonations from older files are looked for within this square of the death and
 *  of every hit on the victim (the selection's widest radius is 30 m; the credit ring's 15 + 5). */
export const EXTRA_BOX_M = 30;
const PREV_DEATHS_LIMIT = 60;
/** The selection reads the whole server this far past the death (`SERVER_WINDOW_AFTER_S`), plus
 *  the 30 s a death's later lines may trail its seed. */
const AFTER_WINDOW_S = 300 + 30;
const AFTER_FILES_MAX = 10;

export interface LoadedDeath {
  ctx: DeathContext;
  input: ContextInput;
  corpus: ServerCorpus;
  lifeId: number;
  serverId: number;
  /** The file the resolved primary death line is in. */
  deathFileId: number;
  /** The death's time on the log clock (UTC seconds). */
  deathTs: number;
  /** The last log-clock second written in the death's file so far. */
  deathFileLastTs: number | null;
  /** A later file of the server exists, or the death's file is marked complete. */
  rotated: boolean;
  /** The server is not in the zone table: its clock was read from `servers.clock_offset_ms`. */
  unknownZone: boolean;
}

type Row = Record<string, unknown>;
const num = (v: unknown): number => Number(v);
const epoch = (v: unknown): number | null => (v == null ? null : Math.floor(new Date(v as string).getTime() / 1000));

async function rows<T extends Row>(db: Database, q: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute<T>(q)) as unknown as T[];
}

/** The `player.died` event of one life's end, or null. Matched by the 40-hex id on the line or a
 *  name the player has carried; any line of the cluster will do. */
async function findSeed(db: Database, serverId: number, endedAt: Date, dayzId: string, aliases: string[]) {
  const lo = new Date(endedAt.getTime() - SEED_WINDOW_S * 1000).toISOString();
  const hi = new Date(endedAt.getTime() + SEED_WINDOW_S * 1000).toISOString();
  const names = aliases.map((a) => a.toLowerCase());
  const r = await rows<{ adm_file_id: string; line_index: number; occurred_at: string }>(db, sql`
    SELECT e.adm_file_id, e.line_index, e.occurred_at FROM events e
    WHERE e.server_id = ${serverId} AND e.type = 'player.died'
      AND e.occurred_at BETWEEN ${lo} AND ${hi}
      AND (e.payload->>'dayzId' = ${dayzId}
           OR lower(e.payload->>'victim') IN (${sql.join(names.map((n) => sql`${n}`), sql`, `)}))
    ORDER BY abs(extract(epoch FROM e.occurred_at - ${endedAt.toISOString()}::timestamptz)), e.id
    LIMIT 1`);
  const s = r[0];
  return s ? { admFileId: num(s.adm_file_id), lineIndex: num(s.line_index) } : null;
}

interface FileRow { id: number; name: string; logDate: number | null; isComplete: boolean }

async function serverFiles(db: Database, serverId: number): Promise<FileRow[]> {
  const r = await rows<{ id: string; name: string; log_date: string | null; is_complete: boolean }>(db, sql`
    SELECT id, name, log_date, is_complete FROM adm_files WHERE server_id = ${serverId}
    ORDER BY log_date NULLS LAST, id`);
  return r.map((f) => ({ id: num(f.id), name: f.name, logDate: epoch(f.log_date), isComplete: !!f.is_complete }));
}

async function loadFiles(db: Database, ids: number[], names: Map<number, string>, cache: FileCache): Promise<LogFile[]> {
  const need = ids.filter((id) => !cache.files.has(id));
  if (need.length) {
    const r = await rows<{ adm_file_id: string; line_index: number; text: string }>(db, sql`
      SELECT adm_file_id, line_index, text FROM raw_lines
      WHERE adm_file_id IN (${sql.join(need.map((id) => sql`${id}`), sql`, `)})
      ORDER BY adm_file_id, line_index`);
    const by = new Map<number, [number, string][]>(need.map((id) => [id, []]));
    for (const l of r) by.get(num(l.adm_file_id))!.push([num(l.line_index), l.text]);
    for (const id of need) cache.files.set(id, { admFileId: id, name: names.get(id) ?? "", lines: by.get(id)! });
  }
  return ids.map((id) => cache.files.get(id)!);
}

/** Each file's number in the order the server booted, over ALL the server's files, from the
 *  header in the first three lines or the date in the name — the order `orderFiles` gives. */
async function bootOrdinals(db: Database, serverId: number, files: FileRow[], cache: FileCache): Promise<ReadonlyMap<number, number>> {
  const hit = cache.boots.get(serverId);
  if (hit && hit.size === files.length) return hit;
  const r = await rows<{ adm_file_id: string; line_index: number; text: string }>(db, sql`
    SELECT r.adm_file_id, r.line_index, r.text FROM raw_lines r JOIN adm_files f ON f.id = r.adm_file_id
    WHERE f.server_id = ${serverId} AND r.line_index < 3`);
  const heads = new Map<number, [number, string][]>(files.map((f) => [f.id, []]));
  for (const l of r) heads.get(num(l.adm_file_id))?.push([num(l.line_index), l.text]);
  const ordered = orderFiles(files.map((f) => ({ admFileId: f.id, name: f.name, lines: heads.get(f.id)! })));
  const out = new Map(ordered.map((f, i) => [f.admFileId, i]));
  cache.boots.set(serverId, out);
  return out;
}

/**
 * The exact second of a line read out of its file, for the hour a zone writes twice. Stamps the
 * whole file (and the one before it, which decides a boot inside that hour).
 */
async function exactTs(db: Database, fileId: number, lineIndex: number, files: FileRow[], boots: ReadonlyMap<number, number>,
  zone: ZoneRule, cache: FileCache): Promise<number | null> {
  const names = new Map(files.map((f) => [f.id, f.name]));
  const me = boots.get(fileId);
  const prevId = me == null ? undefined : [...boots.entries()].find(([, b]) => b === me - 1)?.[0];
  const [file, prev] = await loadFiles(db, prevId == null ? [fileId] : [fileId, prevId], names, cache);
  let previousTs: number | null = null;
  if (prev) {
    const p = orderFiles([prev])[0];
    const s = p ? stampLines(p, zone, null) : [];
    previousTs = s.length ? s[s.length - 1]!.ts : null;
  }
  const f = orderFiles([file!])[0];
  if (!f) return null;
  return stampLines(f, zone, previousTs).find((l) => l.lineIndex === lineIndex)?.ts ?? null;
}

const inBox = (x: number, y: number, centres: Pos[]): boolean =>
  centres.some((c) => Math.abs(c[0] - x) <= EXTRA_BOX_M && Math.abs(c[1] - y) <= EXTRA_BOX_M);

/**
 * Everything the sweep needs for one ended life. Throws `LoadError` when the life cannot be read
 * (no player id, no death event, a previous death whose line is missing).
 */
export async function loadDeath(db: Database, lifeId: number, cache: FileCache = newFileCache()): Promise<LoadedDeath> {
  // 1. Life, player and server.
  const [life] = await rows<{
    id: string; server_id: number; player_id: string; started_at: string; ended_at: string | null;
    dayz_id: string | null; gamertag: string; map: string | null; clock_offset_ms: string | null;
  }>(db, sql`
    SELECT l.id, l.server_id, l.player_id, l.started_at, l.ended_at, p.dayz_id, p.gamertag, s.map, s.clock_offset_ms
    FROM lives l JOIN players p ON p.id = l.player_id JOIN servers s ON s.id = l.server_id
    WHERE l.id = ${lifeId}`);
  if (!life) throw new LoadError("no such life");
  if (!life.ended_at) throw new LoadError("life has not ended");
  if (!life.dayz_id) throw new LoadError("no dayz id");
  const serverId = num(life.server_id), playerId = num(life.player_id), dayzId = life.dayz_id;
  const endedAt = new Date(life.ended_at), startedAt = new Date(life.started_at);
  const aliases = (await rows<{ gamertag: string }>(db, sql`
    SELECT gamertag FROM player_gamertags WHERE player_id = ${playerId}`)).map((a) => a.gamertag);
  if (!aliases.some((a) => a.toLowerCase() === life.gamertag.toLowerCase())) aliases.push(life.gamertag);

  // 2. The seed: any line of the death.
  const seed = await findSeed(db, serverId, endedAt, dayzId, aliases);
  if (!seed) throw new LoadError("no death event");

  // 3. The previous death on this server, resolved the same way.
  const earlier = await rows<{ id: string; ended_at: string }>(db, sql`
    SELECT id, ended_at FROM lives
    WHERE server_id = ${serverId} AND player_id = ${playerId} AND ended_at IS NOT NULL
      AND ended_at < ${endedAt.toISOString()} AND id <> ${lifeId}
    ORDER BY ended_at DESC, id DESC LIMIT ${PREV_DEATHS_LIMIT}`);
  let prevSeed: { admFileId: number; lineIndex: number } | null = null;
  if (earlier[0]) {
    prevSeed = await findSeed(db, serverId, new Date(earlier[0].ended_at), dayzId, aliases);
    if (!prevSeed) throw new LoadError("previous death line not found");
  }

  // 4. The files: from the previous death's file through the file after the death's file.
  const files = await serverFiles(db, serverId);
  const at = files.findIndex((f) => f.id === seed.admFileId);
  if (at < 0) throw new LoadError("death file not found");
  let from: number;
  if (prevSeed) {
    from = files.findIndex((f) => f.id === prevSeed!.admFileId);
    if (from < 0 || from > at) throw new LoadError("previous death file not found");
  } else {
    const lead = Math.floor(startedAt.getTime() / 1000) - FIRST_LIFE_LEAD_S - LOG_DATE_SLACK_S;
    from = 0;
    for (let i = 0; i <= at; i++) if (files[i]!.logDate != null && files[i]!.logDate! <= lead) from = i;
    // A first life starts at the player's first line on the server, which can be a connect that
    // never completed long before the life the fold opened (it opens on `connected`).
    const [early] = await rows<{ adm_file_id: string }>(db, sql`
      SELECT adm_file_id FROM events
      WHERE server_id = ${serverId} AND type IN ('player.connecting', 'player.connected', 'player.disconnected')
        AND payload->>'dayzId' = ${dayzId} AND occurred_at <= ${endedAt.toISOString()}
      ORDER BY occurred_at, id LIMIT 1`);
    const earlyAt = early ? files.findIndex((f) => f.id === num(early.adm_file_id)) : -1;
    if (earlyAt >= 0 && earlyAt < from) from = earlyAt;
  }
  const names = new Map(files.map((f) => [f.id, f.name]));
  const clockOffsetMs = life.clock_offset_ms == null ? null : num(life.clock_offset_ms);
  const zone = zoneForServer(serverId, clockOffsetMs);
  // Through the file after the death's file — and on, while a later file still starts inside the
  // server window after the death: a server that restarts twice in five minutes writes that window
  // into more than one file (the whole-server lines after a death are read up to +300 s).
  let to = Math.min(at + 1, files.length - 1);
  const firstTs = async (i: number): Promise<number | null> => {
    const [f] = await loadFiles(db, [files[i]!.id], names, cache);
    const o = orderFiles([f!])[0];
    const s = o ? stampLines(o, zone, null) : [];
    return s.length ? s[0]!.ts : null;
  };
  const deathFile = (await loadFiles(db, [seed.admFileId], names, cache))[0]!;
  const df = orderFiles([deathFile])[0];
  const seedTs = df ? stampLines(df, zone, null).find((l) => l.lineIndex === seed.lineIndex)?.ts ?? null : null;
  if (seedTs != null) {
    for (let n = 0; n < AFTER_FILES_MAX && to + 1 < files.length; n++) {
      const t = await firstTs(to + 1);
      if (t == null || t > seedTs + AFTER_WINDOW_S) break;
      to++;
    }
  }
  const loadedRows = files.slice(from, to + 1);
  // 5. Whole files from raw_lines, in (adm_file_id, line_index) order.
  const loaded = await loadFiles(db, loadedRows.map((f) => f.id), names, cache);

  const corpus: ServerCorpus = { serverId, map: life.map, clockOffsetMs, files: loaded };
  const boots = await bootOrdinals(db, serverId, files, cache);

  // 6. Placements and detonations near the death from files not loaded. Centres: the death and
  //    every hit on the victim, as the loaded lines place them.
  const all = stampCorpus(corpus);
  const centres: Pos[] = [];
  for (const o of all) {
    if (o.subject?.id !== dayzId || !o.subject.pos) continue;
    if (o.kind === "hit" || (o.admFileId === seed.admFileId && o.lineIndex === seed.lineIndex)) centres.push(o.subject.pos);
  }
  const deathPos = parseEvidenceLine(seed.admFileId, seed.lineIndex,
    loaded.find((f) => f.admFileId === seed.admFileId)?.lines.find((l) => l[0] === seed.lineIndex)?.[1] ?? "").subject?.pos;
  if (deathPos) centres.push(deathPos);
  const extraLines: ExtraLine[] = [];
  const older = files.slice(0, from).map((f) => f.id);
  if (centres.length && older.length) {
    const minX = Math.min(...centres.map((c) => c[0])) - EXTRA_BOX_M, maxX = Math.max(...centres.map((c) => c[0])) + EXTRA_BOX_M;
    const minY = Math.min(...centres.map((c) => c[1])) - EXTRA_BOX_M, maxY = Math.max(...centres.map((c) => c[1])) + EXTRA_BOX_M;
    const cand = await rows<{ adm_file_id: string; line_index: number; text: string; occurred_at: string | null; ev_at: string; x: number; y: number }>(db, sql`
      SELECT e.adm_file_id, e.line_index, r.text, r.occurred_at, e.occurred_at AS ev_at,
             (e.payload->>'x')::float8 AS x, (e.payload->>'y')::float8 AS y
      FROM events e JOIN raw_lines r ON r.adm_file_id = e.adm_file_id AND r.line_index = e.line_index
      WHERE e.server_id = ${serverId}
        AND e.adm_file_id IN (${sql.join(older.map((id) => sql`${id}`), sql`, `)})
        AND (e.type = 'build.placed'
             OR (e.type = 'player.hit' AND (r.text LIKE '%TripWireHit%' OR r.text LIKE '%LandMineExplosion%')))
        AND (e.payload->>'x')::float8 BETWEEN ${minX} AND ${maxX}
        AND (e.payload->>'y')::float8 BETWEEN ${minY} AND ${maxY}
      ORDER BY e.adm_file_id, e.line_index`);
    const seen = new Set<string>();
    for (const c of cand) {
      const fileId = num(c.adm_file_id), lineIndex = num(c.line_index);
      const key = `${fileId}:${lineIndex}`;
      if (seen.has(key) || !inBox(Number(c.x), Number(c.y), centres)) continue;
      seen.add(key);
      const name = names.get(fileId) ?? "";
      const approxTs = epoch(c.occurred_at) ?? epoch(c.ev_at);
      const x: ExtraLine = { admFileId: fileId, fileName: name, lineIndex, text: c.text, approxTs };
      // ⚠️ On a clock-change night occurred_at is no hint: stamp the whole file for the exact second.
      if (detachedIsAmbiguous(name, c.text, zone, approxTs)) x.ts = await exactTs(db, fileId, lineIndex, files, boots, zone, cache);
      extraLines.push(x);
    }
  }

  // 7. Earlier deaths of the same id, older than the loaded files: (log-clock second, position).
  const earlierDeaths: { ts: number; pos: Pos | null }[] = [];
  const firstLoaded = new Set(loadedRows.map((f) => f.id));
  for (const e of earlier) {
    const s = await findSeed(db, serverId, new Date(e.ended_at), dayzId, aliases);
    if (!s || firstLoaded.has(s.admFileId)) continue;
    const [line] = await rows<{ text: string }>(db, sql`
      SELECT text FROM raw_lines WHERE adm_file_id = ${s.admFileId} AND line_index = ${s.lineIndex}`);
    if (!line) continue;
    const ts = stampDetached(names.get(s.admFileId) ?? "", line.text, zone, epoch(e.ended_at));
    if (ts == null) continue;
    earlierDeaths.push({ ts, pos: parseEvidenceLine(s.admFileId, s.lineIndex, line.text).subject?.pos ?? null });
  }

  // 8. The one selection rule, then the context.
  let input: ContextInput;
  try {
    input = selectContextLines(corpus, seed, extraLines, { earlierDeaths, bootOrdinals: boots });
  } catch (err) {
    throw new LoadError(err instanceof Error ? err.message : String(err));
  }
  const ctx = buildDeathContext(input);
  const deathFileId = input.deathRef.admFileId;
  let deathFileLastTs: number | null = null;
  for (const o of all) if (o.admFileId === deathFileId) deathFileLastTs = o.ts;
  const deathIdx = files.findIndex((f) => f.id === deathFileId);
  const rotated = deathIdx >= 0 && (deathIdx < files.length - 1 || files[deathIdx]!.isComplete);
  return {
    ctx, input, corpus, lifeId, serverId, deathFileId, deathTs: ctx.t0, deathFileLastTs, rotated,
    unknownZone: !isKnownServer(serverId),
  };
}

/** The classifier's context for one ended life (spec 4.2). Throws `LoadError`. */
export async function loadDeathContext(db: Database, lifeId: number, cache?: FileCache): Promise<DeathContext> {
  return (await loadDeath(db, lifeId, cache)).ctx;
}
