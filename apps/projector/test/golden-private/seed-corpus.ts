import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { parseLine, type ParsedLine } from "@onelife/adm-parser";
import { events, kills, rawLines, type Database } from "@onelife/db";

/**
 * Seeds a test database with the PRIVATE One Life export under `$DEATH_GOLDEN_DIR/corpus`: servers,
 * log files and raw lines with their stored ids, the events the current parser reads from each
 * line, players, lives (with their production ids) and kills. What the verdict sweep then reads is
 * what production holds, so the stored verdicts can be compared with the reference's answers.
 *
 * ⚠️ PRIVATE DATA. Nothing here may print a name, an id, a line or a position; the data never
 * leaves the test database, which the suite truncates afterwards.
 */

type Rec = Record<string, string>;
function readCsv(path: string): Rec[] {
  const text = readFileSync(path, "utf8");
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift() ?? [];
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}
const nul = (v: string | undefined): string | null => (v == null || v === "" || v === "\\N" ? null : v);

const KIND_TO_TYPE: Record<ParsedLine["kind"], string> = {
  connecting: "player.connecting", connected: "player.connected", disconnected: "player.disconnected",
  death: "player.died", position: "player.position", emote: "emote.performed", hit: "player.hit",
  unconscious: "player.unconscious", build: "build.placed", teleport: "player.teleported",
  roster: "roster.snapshot", boot: "server.rebooted",
};

async function chunked<T>(rows: T[], size: number, f: (part: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += size) await f(rows.slice(i, i + size));
}

export interface SeededCorpus { deadLives: number; lines: number; events: number }

/** Seeds the One Life export. The database must hold none of these servers, files or lives yet. */
export async function seedCorpus(db: Database, gold: string): Promise<SeededCorpus> {
  const dir = join(gold, "corpus");
  for (const s of readCsv(join(dir, "ol_servers.csv"))) {
    await db.execute(sql`
      INSERT INTO servers (id, nitrado_service_id, name, map, slug, active, clock_offset_ms, retired_at)
      OVERRIDING SYSTEM VALUE
      VALUES (${Number(s.id)}, ${Number(s.nitrado_service_id) + 9_000_000_000}, ${`golden-${s.id}`}, ${s.map}, ${nul(s.slug) ? `golden-${s.id}` : null},
              ${s.active === "t"}, ${Number(s.clock_offset_ms)}, ${nul(s.retired_at)})`);
  }
  const files = readCsv(join(dir, "ol_adm_files.csv"));
  await chunked(files, 500, (part) => db.execute(sql`
    INSERT INTO adm_files (id, server_id, path, name, log_date, last_processed_line, is_complete)
    VALUES ${sql.join(part.map((f) => sql`(${Number(f.id)}, ${Number(f.server_id)}, ${f.path}, ${f.name}, ${nul(f.log_date)}, ${Number(f.last_processed_line)}, ${f.is_complete === "t"})`), sql`, `)}`));

  const deathAt = new Map<string, string>();
  for (const e of readCsv(join(dir, "ol_death_events.csv"))) deathAt.set(`${e.adm_file_id}:${e.line_index}`, e.occurred_at!);

  // Raw lines (server, file, line, stored time, text) and the events of each line.
  const text = readFileSync(join(dir, "ol_raw_lines.tsv"), "utf8");
  const raw: (typeof rawLines.$inferInsert)[] = [];
  const evs: (typeof events.$inferInsert)[] = [];
  const nameToId = new Map<string, string>();
  let last: Date = new Date(0);
  for (const ln of text.split("\n")) {
    if (!ln) continue;
    const parts: string[] = [];
    let at = 0;
    for (let i = 0; i < 4; i++) { const t = ln.indexOf("\t", at); parts.push(ln.slice(at, t)); at = t + 1; }
    const body = ln.slice(at).replace(/\r$/, "");
    const serverId = Number(parts[0]), admFileId = Number(parts[1]), lineIndex = Number(parts[2]);
    const stored = nul(parts[3]);
    const when = new Date(deathAt.get(`${admFileId}:${lineIndex}`) ?? stored ?? last.toISOString());
    last = when;
    raw.push({ serverId, admFileId, lineIndex, occurredAt: stored ? new Date(stored) : null, text: body });
    parseLine(body).forEach((p, sub) => {
      const { kind, ...payload } = p as ParsedLine & Record<string, unknown>;
      const type = p.kind === "build" ? `build.${p.action}` : KIND_TO_TYPE[kind as ParsedLine["kind"]];
      if (p.kind === "connected" && p.dayzId) nameToId.set(p.gamertag.toLowerCase(), p.dayzId);
      evs.push({ serverId, admFileId, lineIndex, subIndex: sub, type, occurredAt: when, payload });
    });
  }
  await chunked(raw, 2000, (part) => db.insert(rawLines).values(part));
  await chunked(evs, 2000, (part) => db.insert(events).values(part));

  // Players: the export holds lives with the player's current gamertag. The id comes from the
  // death line of one of their lives (exact even after a rename), else from a connect line.
  const livesCsv = readCsv(join(dir, "ol_lives.csv"));
  const deaths = (await db.execute<{ server_id: number; occurred_at: string; victim: string; dayz_id: string }>(sql`
    SELECT server_id, occurred_at, payload->>'victim' AS victim, payload->>'dayzId' AS dayz_id FROM events WHERE type = 'player.died'`)) as unknown as
    { server_id: number; occurred_at: string; victim: string; dayz_id: string }[];
  const deathsAt = new Map<string, { victim: string; dayzId: string }[]>();
  for (const d of deaths) {
    const k = `${d.server_id}|${new Date(d.occurred_at).getTime()}`;
    if (!deathsAt.has(k)) deathsAt.set(k, []);
    deathsAt.get(k)!.push({ victim: d.victim, dayzId: d.dayz_id });
  }
  const players = new Map<number, { gamertag: string; dayzId: string | null }>();
  for (const l of livesCsv) {
    const pid = Number(l.player_id);
    if (!players.has(pid)) players.set(pid, { gamertag: l.gamertag!, dayzId: null });
    const p = players.get(pid)!;
    if (p.dayzId || !nul(l.ended_at)) continue;
    const at = new Date(l.ended_at!).getTime();
    const near = [-1000, 0, 1000].flatMap((dt) => deathsAt.get(`${l.server_id}|${at + dt}`) ?? []);
    const byName = near.filter((d) => d.victim.toLowerCase() === p.gamertag.toLowerCase());
    const pick = byName.length ? byName : near.length === 1 ? near : [];
    if (pick[0]) p.dayzId = pick[0].dayzId;
  }
  const used = new Set<string>();
  for (const p of players.values()) {
    p.dayzId ??= nameToId.get(p.gamertag.toLowerCase()) ?? null;
    if (p.dayzId && used.has(p.dayzId)) p.dayzId = null;
    if (p.dayzId) used.add(p.dayzId);
  }
  await chunked([...players.entries()], 500, (part) => db.execute(sql`
    INSERT INTO players (id, gamertag, dayz_id)
    VALUES ${sql.join(part.map(([id, p]) => sql`(${id}, ${p.gamertag}, ${p.dayzId})`), sql`, `)}`));
  await chunked(livesCsv, 500, (part) => db.execute(sql`
    INSERT INTO lives (id, server_id, player_id, life_number, started_at, ended_at, death_cause, death_by_gamertag, death_weapon, death_distance, playtime_seconds)
    VALUES ${sql.join(part.map((l) => sql`(${Number(l.id)}, ${Number(l.server_id)}, ${Number(l.player_id)}, ${Number(l.life_number)}, ${l.started_at}, ${nul(l.ended_at)},
      ${nul(l.death_cause)}, ${nul(l.death_by_gamertag)}, ${nul(l.death_weapon)}, ${nul(l.death_distance) == null ? null : Number(l.death_distance)}, ${Number(l.playtime_seconds)})`), sql`, `)}`));
  for (const k of readCsv(join(dir, "ol_kills.csv"))) {
    await db.insert(kills).values({
      serverId: Number(k.server_id), killerGamertag: k.killer_gamertag!, killerPlayerId: nul(k.killer_player_id) == null ? null : Number(k.killer_player_id),
      victimGamertag: k.victim_gamertag!, victimPlayerId: nul(k.victim_player_id) == null ? null : Number(k.victim_player_id),
      victimLifeId: nul(k.victim_life_id) == null ? null : Number(k.victim_life_id), weapon: nul(k.weapon),
      distance: nul(k.distance) == null ? null : Number(k.distance), occurredAt: new Date(k.occurred_at!),
    });
  }
  return { deadLives: livesCsv.filter((l) => nul(l.ended_at)).length, lines: raw.length, events: evs.length };
}
