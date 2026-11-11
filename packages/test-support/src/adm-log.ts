import { parseLine, type ParsedLine } from "@onelife/adm-parser";
import { orderFiles, stampLines, zoneForServer } from "@onelife/death-verdict";
import { admFiles, events, rawLines, type Database } from "@onelife/db";

/**
 * Writes hand-made ADM log files into a test database the way ingest does: an `adm_files` row,
 * every line into `raw_lines`, and the events the real parser reads from each line into `events`.
 * For the stored-verdict suites (the death-context loader, the verdict sweep), which read the log
 * back out of `raw_lines`.
 *
 * ⚠️ Invented lines only. This repository is public; a real log line identifies a real player.
 *
 * `occurred_at` is the log clock's own reading of each line (the server's zone rule), so a life's
 * `ended_at` can be set from `at(fileId, lineIndex)` and the loader's seed lookup finds it.
 */
export interface SeedFile {
  /** e.g. "2031-06-10". */
  date: string;
  /** The header's start time, "HH:MM:SS". */
  start: string;
  /** Each line as [clock "HH:MM:SS", the text after "HH:MM:SS | "]. A null clock writes the text as is. */
  lines: [clock: string | null, rest: string][];
  complete?: boolean;
  /** `raw_lines.occurred_at` for every line: shifted by this many seconds (stored skew), or null. */
  occurredSkewS?: number | null;
}

export interface SeededLog {
  fileIds: number[];
  /** The UTC instant the log clock gives a line. */
  at: (fileId: number, lineIndex: number) => Date;
  /** The file's line index of the n-th entry of `lines` (0-based): the banner and header come first. */
  idx: (n: number) => number;
}

const KIND_TO_TYPE: Record<ParsedLine["kind"], string> = {
  connecting: "player.connecting", connected: "player.connected", disconnected: "player.disconnected",
  death: "player.died", position: "player.position", emote: "emote.performed", hit: "player.hit",
  unconscious: "player.unconscious", build: "build.placed", teleport: "player.teleported",
  roster: "roster.snapshot", boot: "server.rebooted",
};

export async function seedAdmLog(db: Database, serverId: number, files: SeedFile[], clockOffsetMs: number | null = 0): Promise<SeededLog> {
  const zone = zoneForServer(serverId, clockOffsetMs);
  const times = new Map<string, Date>();
  const fileIds: number[] = [];
  let previous: number | null = null;
  for (const f of files) {
    const name = `DayZServer_X1_x64_${f.date}_${f.start.replace(/:/g, "-")}.ADM`;
    const texts = ["******************************************", `AdminLog started on ${f.date} at ${f.start}`,
      ...f.lines.map(([c, rest]) => (c == null ? rest : `${c} | ${rest}`))];
    const [row] = await db.insert(admFiles).values({
      serverId, path: `/test/${name}`, name, logDate: new Date(`${f.date}T${f.start}Z`), lastProcessedLine: texts.length,
      isComplete: f.complete ?? false,
    }).returning({ id: admFiles.id });
    const fileId = Number(row!.id);
    fileIds.push(fileId);
    const ordered = orderFiles([{ admFileId: fileId, name, lines: texts.map((t, i) => [i, t] as [number, string]) }])[0]!;
    const stamped = stampLines(ordered, zone, previous);
    if (stamped.length) previous = stamped[stamped.length - 1]!.ts;
    const tsOf = new Map(stamped.map((s) => [s.lineIndex, s.ts]));
    const lineRows = texts.map((text, i) => {
      const t = new Date((tsOf.get(i) ?? ordered.bootLocal) * 1000);
      times.set(`${fileId}:${i}`, t);
      const occurredAt = f.occurredSkewS === null ? null : new Date(t.getTime() + (f.occurredSkewS ?? 0) * 1000);
      return { serverId, admFileId: fileId, lineIndex: i, occurredAt, text };
    });
    const inserted = await db.insert(rawLines).values(lineRows).returning({ id: rawLines.id, lineIndex: rawLines.lineIndex });
    const rawId = new Map(inserted.map((r) => [r.lineIndex, Number(r.id)]));
    const evRows: (typeof events.$inferInsert)[] = [];
    texts.forEach((text, i) => {
      parseLine(text).forEach((p, sub) => {
        const { kind, ...payload } = p as ParsedLine & Record<string, unknown>;
        const type = p.kind === "build" ? `build.${p.action}` : KIND_TO_TYPE[kind as ParsedLine["kind"]];
        evRows.push({
          serverId, admFileId: fileId, lineIndex: i, subIndex: sub, type, occurredAt: times.get(`${fileId}:${i}`)!,
          payload, rawLineId: rawId.get(i) ?? null,
        });
      });
    });
    if (evRows.length) await db.insert(events).values(evRows);
  }
  return {
    fileIds,
    at: (fileId, lineIndex) => {
      const t = times.get(`${fileId}:${lineIndex}`);
      if (!t) throw new Error(`seedAdmLog: no line ${fileId}:${lineIndex}`);
      return t;
    },
    idx: (n) => n + 2,
  };
}

// ── Invented line builders. Names are made up and ids are one digit repeated forty times. ──

export type Who = { name: string; id: string };
export const fakeId = (digit: string): string => digit.repeat(40);
export const at = (x: number, z: number, alt = 10): string => `<${x.toFixed(1)}, ${z.toFixed(1)}, ${alt.toFixed(1)}>`;
/** `Player "name" (id=... pos=<...>)`, or the `(DEAD)` form. */
export const who = (p: Who, x = 1000, z = 2000, dead = false): string =>
  `Player "${p.name}" ${dead ? "(DEAD) " : ""}(id=${p.id} pos=${at(x, z)})`;
export const line = {
  connected: (p: Who, x = 1000, z = 2000) => `${who(p, x, z)} is connected`,
  pos: (p: Who, x = 1000, z = 2000) => who(p, x, z),
  died: (p: Who, x = 1000, z = 2000, water = 500, energy = 500) =>
    `${who(p, x, z, true)} died. Stats> Water: ${water} Energy: ${energy} Bleed sources: 0`,
  suicide: (p: Who, x = 1000, z = 2000) => `${who(p, x, z)} committed suicide`,
  wire: (p: Who, x = 1000, z = 2000) => `${who(p, x, z)} placed Tripwire<TripwireTrap>`,
  trip: (p: Who, x = 1000, z = 2000) => `${who(p, x, z)}[HP: 100] hit by TripwireTrap into (-1) for 0 damage (TripWireHit)`,
  fragBlast: (p: Who, x = 1000, z = 2000) => `${who(p, x, z, true)}[HP: 0] hit by explosion (M67Grenade_Ammo)`,
  fragKill: (p: Who, x = 1000, z = 2000) => `${who(p, x, z, true)} killed by 6-M7 Frag Grenade`,
  shotBy: (p: Who, by: Who, hp: number, x = 1000, z = 2000) =>
    `${who(p, x, z)}[HP: ${hp}] hit by ${who(by, x + 40, z)} into Torso(0) for 40 damage (Bullet_556x45) with M4-A1 from 40 meters`,
  killedBy: (p: Who, by: Who, x = 1000, z = 2000) =>
    `${who(p, x, z, true)} killed by ${who(by, x + 40, z)} with M4-A1 from 40 meters`,
};
