import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { sql as dsql } from "drizzle-orm";
import { servers, players, lives } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { seedAdmLog, line, fakeId, type Who } from "@onelife/test-support/adm-log";
import { classifyDeath } from "@onelife/death-verdict";
import { loadDeath, loadDeathContext, LoadError } from "../src/death-context.js";

/**
 * The death-context loader against Postgres. ⚠️ Every name, id and line is invented: three
 * made-up lives written as ADM files into raw_lines and events the way ingest does.
 */
const { db, sql } = getTestDb();
const V: Who = { name: "Victim One", id: fakeId("1") };
const O: Who = { name: "Other Two", id: fakeId("2") };

let sid: number;
async function server(): Promise<number> {
  const [s] = await db.insert(servers).values({ nitradoServiceId: Math.floor(Math.random() * 1e8) + 5e8, name: "DC", map: "chernarusplus" }).returning();
  return s!.id;
}
async function player(p: Who, dayzId: string | null = p.id): Promise<number> {
  const [r] = await db.insert(players).values({ gamertag: p.name, dayzId }).returning();
  return Number(r!.id);
}
async function life(playerId: number, n: number, startedAt: Date, endedAt: Date | null, deathCause: string | null = "died"): Promise<number> {
  const [r] = await db.insert(lives).values({ serverId: sid, playerId, lifeNumber: n, startedAt, endedAt, deathCause, playtimeSeconds: 600 }).returning();
  return Number(r!.id);
}

beforeEach(async () => {
  await db.execute(dsql`TRUNCATE lives, players, events, raw_lines, adm_files, servers RESTART IDENTITY CASCADE`);
  sid = await server();
});
afterAll(async () => { await sql.end(); });

describe("loadDeathContext", () => {
  it("a firearm-order suicide seeded from the suicide line resolves to the died line", async () => {
    const log = await seedAdmLog(db, sid, [{
      date: "2031-06-10", start: "12:00:00", complete: true,
      lines: [["12:01:00", line.connected(V)], ["12:20:00", line.suicide(V)], ["12:20:00", line.died(V)]],
    }]);
    const [f] = log.fileIds;
    const pid = await player(V);
    // the fold ends the life on the first death line it sees: the suicide line
    const lid = await life(pid, 1, log.at(f!, log.idx(0)), log.at(f!, log.idx(1)), "suicide");
    const d = await loadDeath(db, lid);
    expect(d.ctx.cluster.primary).toEqual({ admFileId: f, lineIndex: log.idx(2) });
    const v = classifyDeath(d.ctx);
    expect(v).toMatchObject({ rule: "B01", cause: "suicide", deathRef: { admFileId: f, lineIndex: log.idx(2) } });
    expect(d.rotated).toBe(true);
  });

  it("a life across three files", async () => {
    const log = await seedAdmLog(db, sid, [
      { date: "2031-06-10", start: "08:00:00", lines: [["08:10:00", line.connected(V)], ["09:00:00", line.pos(V, 1010)]] },
      { date: "2031-06-10", start: "12:00:00", lines: [["12:30:00", line.pos(V, 1005)], ["12:40:00", line.shotBy(V, O, 60)]] },
      { date: "2031-06-10", start: "16:00:00", lines: [["16:05:00", line.shotBy(V, O, 0)], ["16:05:00", line.killedBy(V, O)]] },
    ]);
    const [a, , c] = log.fileIds;
    const pid = await player(V);
    await player(O);
    const lid = await life(pid, 1, log.at(a!, log.idx(0)), log.at(c!, log.idx(1)), "pvp");
    const d = await loadDeath(db, lid);
    expect(new Set(d.ctx.life.map((l) => l.admFileId))).toEqual(new Set(log.fileIds));
    expect(classifyDeath(d.ctx)).toMatchObject({ rule: "A04", cause: "pvp", attribution: { basis: "kill_line", dayzId: O.id } });
    // the death's file is the newest: nothing has rotated it yet
    expect(d.rotated).toBe(false);
  });

  it("a previous death days earlier bounds the life", async () => {
    const log = await seedAdmLog(db, sid, [
      { date: "2031-06-01", start: "08:00:00", lines: [["08:10:00", line.connected(V)], ["08:30:00", line.pos(V, 900)]] },
      { date: "2031-06-03", start: "08:00:00", lines: [["08:10:00", line.pos(V, 950)], ["08:20:00", line.died(V, 950)], ["08:25:00", line.connected(V, 1200)]] },
      { date: "2031-06-04", start: "08:00:00", lines: [["08:10:00", line.pos(V, 1100)]] },
      { date: "2031-06-06", start: "08:00:00", lines: [["08:10:00", line.pos(V, 1000)], ["08:40:00", line.died(V)]] },
    ]);
    const [f0, f1, , f3] = log.fileIds;
    const pid = await player(V);
    await life(pid, 1, log.at(f0!, log.idx(0)), log.at(f1!, log.idx(1)));
    const lid = await life(pid, 2, log.at(f1!, log.idx(2)), log.at(f3!, log.idx(1)));
    const d = await loadDeath(db, lid);
    expect(d.corpus.files.map((f) => f.admFileId)).toEqual([f1, log.fileIds[2], f3]);
    expect(d.ctx.life.every((l) => l.admFileId !== f0)).toBe(true);
    expect(d.ctx.life.some((l) => l.admFileId === f1 && l.lineIndex === log.idx(1))).toBe(false);
    expect(d.ctx.life[0]).toMatchObject({ admFileId: f1, lineIndex: log.idx(2) });
    expect(d.ctx.fresh).toBe(true);
  });

  it("a first life on a Pacific host is loaded from the file it started in", async () => {
    // adm_files.log_date is the wall clock labelled as UTC: seven hours early in summer here
    const [s2] = await db.insert(servers).values({ nitradoServiceId: Math.floor(Math.random() * 1e8) + 5e8, name: "DC2", map: "chernarusplus" }).returning();
    sid = s2!.id;
    expect(sid).not.toBe(1); // server 1 is the one host the zone table keeps at UTC-4
    const log = await seedAdmLog(db, sid, [
      { date: "2031-06-10", start: "08:00:00", lines: [["08:10:00", line.connected(V)], ["08:20:00", line.pos(V, 1010)]] },
      { date: "2031-06-10", start: "09:30:00", lines: [["09:40:00", line.pos(V, 1000)], ["10:00:00", line.died(V)]] },
    ]);
    const [a, b] = log.fileIds;
    const pid = await player(V);
    const lid = await life(pid, 1, log.at(a!, log.idx(0)), log.at(b!, log.idx(1)));
    const d = await loadDeath(db, lid);
    expect(d.corpus.files.map((f) => f.admFileId)).toEqual([a, b]);
    expect(d.ctx.life[0]).toMatchObject({ admFileId: a, lineIndex: log.idx(0) });
  });

  it("a first life is loaded from the player's first connect line on the server, even one days earlier", async () => {
    const log = await seedAdmLog(db, sid, [
      { date: "2031-06-01", start: "08:00:00", lines: [
        ["08:10:00", `Player "${V.name}" (id=${V.id}) is connecting`],
        ["08:10:05", `Player "${V.name}" (id=${V.id} pos=<1000.0, 2000.0, 10.0>) has been disconnected`],
      ] },
      { date: "2031-06-04", start: "08:00:00", lines: [["08:10:00", line.connected(V)], ["08:40:00", line.died(V)]] },
    ]);
    const [a, b] = log.fileIds;
    const pid = await player(V);
    const lid = await life(pid, 1, log.at(b!, log.idx(0)), log.at(b!, log.idx(1)));
    const d = await loadDeath(db, lid);
    expect(d.corpus.files.map((f) => f.admFileId)).toEqual([a, b]);
  });

  it("loads every later file that starts inside the five minutes after the death", async () => {
    const log = await seedAdmLog(db, sid, [
      { date: "2031-06-04", start: "08:00:00", lines: [["08:10:00", line.connected(V)], ["08:40:00", line.died(V)]] },
      { date: "2031-06-04", start: "08:41:00", lines: [] },
      { date: "2031-06-04", start: "08:43:00", lines: [["08:43:30", line.connected(O, 1010)]] },
      { date: "2031-06-04", start: "09:30:00", lines: [["09:31:00", line.connected(O, 1010)]] },
    ]);
    const pid = await player(V);
    const lid = await life(pid, 1, log.at(log.fileIds[0]!, log.idx(0)), log.at(log.fileIds[0]!, log.idx(1)));
    const d = await loadDeath(db, lid);
    expect(d.corpus.files.map((f) => f.admFileId)).toEqual(log.fileIds.slice(0, 3));
    expect(d.ctx.server.lines.some((l) => l.admFileId === log.fileIds[2] && l.subject?.id === O.id)).toBe(true);
  });

  it("a missing previous death line throws", async () => {
    const log = await seedAdmLog(db, sid, [
      { date: "2031-06-06", start: "08:00:00", lines: [["08:10:00", line.connected(V)], ["08:40:00", line.died(V)]] },
    ]);
    const [f] = log.fileIds;
    const pid = await player(V);
    // an earlier death on this server whose line was never ingested
    await life(pid, 1, new Date("2031-06-01T00:00:00Z"), new Date("2031-06-02T00:00:00Z"));
    const lid = await life(pid, 2, log.at(f!, log.idx(0)), log.at(f!, log.idx(1)));
    await expect(loadDeathContext(db, lid)).rejects.toThrow(LoadError);
    await expect(loadDeathContext(db, lid)).rejects.toThrow("previous death line not found");
  });

  it("a null dayz id throws", async () => {
    const log = await seedAdmLog(db, sid, [
      { date: "2031-06-06", start: "08:00:00", lines: [["08:10:00", line.connected(V)], ["08:40:00", line.died(V)]] },
    ]);
    const [f] = log.fileIds;
    const pid = await player(V, null);
    const lid = await life(pid, 1, log.at(f!, log.idx(0)), log.at(f!, log.idx(1)));
    await expect(loadDeathContext(db, lid)).rejects.toThrow("no dayz id");
  });

  it("a life with no death event throws", async () => {
    await seedAdmLog(db, sid, [{ date: "2031-06-06", start: "08:00:00", lines: [["08:10:00", line.connected(V)]] }]);
    const pid = await player(V);
    const lid = await life(pid, 1, new Date("2031-06-06T08:10:00Z"), new Date("2031-06-06T09:00:00Z"));
    await expect(loadDeathContext(db, lid)).rejects.toThrow("no death event");
  });

  it("a null occurred_at line is still loaded", async () => {
    const log = await seedAdmLog(db, sid, [{
      date: "2031-06-06", start: "08:00:00", occurredSkewS: null,
      lines: [["08:10:00", line.connected(V)], ["08:20:00", line.shotBy(V, O, 30)], ["08:40:00", line.died(V)]],
    }]);
    const [f] = log.fileIds;
    const pid = await player(V);
    const lid = await life(pid, 1, log.at(f!, log.idx(0)), log.at(f!, log.idx(2)));
    const d = await loadDeath(db, lid);
    expect(d.ctx.life.some((l) => l.lineIndex === log.idx(1) && l.kind === "hit")).toBe(true);
    expect(d.ctx.hits).toHaveLength(1);
  });

  it("a tripwire placed in a file before the loaded ones is handed over and credited", async () => {
    const log = await seedAdmLog(db, sid, [
      { date: "2031-06-01", start: "08:00:00", lines: [["08:10:00", line.wire(O, 1001.5)], ["08:12:00", line.wire(O, 3000)]] },
      { date: "2031-06-03", start: "08:00:00", lines: [["08:10:00", line.connected(V, 1200)], ["08:20:00", line.died(V, 1200)], ["08:25:00", line.connected(V, 1100)]] },
      { date: "2031-06-04", start: "08:00:00", lines: [
        ["08:10:00", line.pos(V, 1000)], ["08:30:00", line.trip(V)], ["08:30:04", line.fragBlast(V)], ["08:30:04", line.fragKill(V)],
      ] },
    ]);
    const [f0, f1, f2] = log.fileIds;
    const pid = await player(V);
    await player(O);
    await life(pid, 1, log.at(f1!, log.idx(0)), log.at(f1!, log.idx(1)));
    const lid = await life(pid, 2, log.at(f1!, log.idx(2)), log.at(f2!, log.idx(3)), "explosion");
    const d = await loadDeath(db, lid);
    expect(d.corpus.files.map((f) => f.admFileId)).toEqual([f1, f2]);
    expect(d.input.placements).toEqual([{ admFileId: f0, lineIndex: log.idx(0) }]);
    const v = classifyDeath(d.ctx);
    expect(v).toMatchObject({ rule: "A07", cause: "explosive_trap" });
    expect(v.evidence.credit).toMatchObject({ outcome: "evidence_passes", placerDayzId: O.id, placement: { admFileId: f0, lineIndex: log.idx(0) } });
  });
});
