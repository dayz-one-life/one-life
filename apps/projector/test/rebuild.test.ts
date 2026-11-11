import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, players, lives, admFiles, playerGamertags, unconsciousEvents, kills, deathVerdicts } from "@onelife/db";
import { eq, sql as dsql } from "drizzle-orm";
import { seedAdmLog, line, fakeId } from "@onelife/test-support/adm-log";
import { sweepVerdicts } from "../src/verdict-sweep.js";
import { getCursor, setCursor, appendEvent } from "@onelife/event-log";
import { rebuildAll, REBUILD_TRUNCATE_TABLES } from "../src/rebuild.js";
import { projectorTick } from "../src/tick.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 8e8;
let serverId: number;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "rebuild-test" }).returning();
  serverId = s!.id;
  await db.insert(players).values({ gamertag: `Stale-${svc}`, firstSeenAt: new Date(), lastSeenAt: new Date() });
  await setCursor(db, "projector", 999999);
});
afterAll(async () => { await sql.end(); });

describe("rebuildAll", () => {
  it("truncates projections and resets the cursor to 0", async () => {
    await rebuildAll(db);
    const rows = await db.select().from(players).where(eq(players.gamertag, `Stale-${svc}`));
    expect(rows.length).toBe(0);
    expect(await getCursor(db, "projector")).toBe(0);
  });

  it("clears player_gamertags via CASCADE even though it is NOT named in the truncate list", async () => {
    const [p] = await db.insert(players)
      .values({ gamertag: `RB${Date.now()}`, dayzId: `RB=${Date.now()}`, firstSeenAt: new Date(), lastSeenAt: new Date() })
      .returning();
    await db.insert(playerGamertags).values({
      playerId: p!.id, gamertag: p!.gamertag, firstSeenAt: new Date(), lastSeenAt: new Date(),
    });
    await rebuildAll(db, `rb-test-${p!.id}`);
    // player_gamertags is deliberately absent from REBUILD_TRUNCATE_TABLES (see below), yet it
    // is still emptied — TRUNCATE players ... CASCADE reaches it through its FK. This proves
    // removing the explicit entry (the v0.42.1 deploy fix) loses nothing.
    const rows = await db.select().from(playerGamertags);
    expect(rows).toHaveLength(0);
  });

  it("does not name a table a same-release migration creates — the v0.42.1 deploy bug", () => {
    // deploy.sh runs the rebuild phase BEFORE migrate, so on the deploy that introduces a
    // projection table it does not exist yet when rebuildAll runs. Naming player_gamertags
    // here aborted that TRUNCATE with `relation "player_gamertags" does not exist` and took the
    // v0.42.1 deploy down. It must NOT be listed; the CASCADE test above proves it is cleared
    // anyway. `players` must stay listed — it is the parent the cascade flows from.
    expect(REBUILD_TRUNCATE_TABLES as readonly string[]).not.toContain("player_gamertags");
    expect(REBUILD_TRUNCATE_TABLES as readonly string[]).toContain("players");
  });

  // unconscious_events is deliberately ABSENT from REBUILD_TRUNCATE_TABLES — it is cleared via the
  // FK to players by RESTART IDENTITY CASCADE. Naming a newly-created table in that list aborts the
  // rebuild phase, which runs BEFORE migrate (this killed the v0.42.1 deploy). If someone drops the
  // FK, the cascade stops reaching it and rows survive a rebuild forever — this test is the alarm.
  it("rebuildAll clears unconscious_events via the players cascade", async () => {
    const [s] = await db.insert(servers).values({ nitradoServiceId: svc + 1, name: "rebuild-unconscious-test" }).returning();
    const [p] = await db.insert(players)
      .values({ gamertag: `UC-${svc}`, dayzId: `UC=${svc}`, firstSeenAt: new Date(), lastSeenAt: new Date() })
      .returning();
    await db.insert(unconsciousEvents).values({
      serverId: s!.id, playerId: p!.id, gamertag: p!.gamertag, disconnecting: false, occurredAt: new Date(),
    });
    // Assert the seed landed BEFORE rebuilding: without this the post-rebuild toHaveLength(0)
    // passes just as happily against an insert that never wrote a row, so the cascade would go
    // unexercised and the test would report green for the wrong reason.
    expect(await db.select().from(unconsciousEvents).where(eq(unconsciousEvents.serverId, s!.id))).toHaveLength(1);
    await rebuildAll(db);
    const rows = await db.select().from(unconsciousEvents);
    expect(rows).toHaveLength(0);
  });

  it("after a rebuild + re-fold, one gamertag on two servers yields one global player with a per-server life", async () => {
    const svc2 = Math.floor(Math.random() * 1e8) + 8e8;
    const consumer = `rebuild-multi-${svc2}`;
    const gamertag = `Multi-${svc2}`;

    const [serverA] = await db.insert(servers).values({ nitradoServiceId: svc2, name: "rebuild-multi-a" }).returning();
    const [serverB] = await db.insert(servers).values({ nitradoServiceId: svc2 + 1, name: "rebuild-multi-b" }).returning();
    const [fileA] = await db.insert(admFiles).values({ serverId: serverA!.id, path: `/t/${svc2}-a.ADM`, name: "a.ADM" }).returning();
    const [fileB] = await db.insert(admFiles).values({ serverId: serverB!.id, path: `/t/${svc2}-b.ADM`, name: "b.ADM" }).returning();

    await appendEvent(db, {
      serverId: serverA!.id, admFileId: fileA!.id, lineIndex: 0, subIndex: 0,
      type: "player.connected", occurredAt: new Date("2026-07-06T12:00:00Z"),
      // ONE account hash across both servers — identity is the DayZ account, which does not
      // change per server. (This fixture used to mint a distinct hash per server; that only
      // folded to one row because players_gamertag_uniq merged them by name, which is the
      // silent merge migration 0025 removes.)
      payload: { gamertag, dayzId: `${svc2}-ONE=` },
    });
    await appendEvent(db, {
      serverId: serverB!.id, admFileId: fileB!.id, lineIndex: 0, subIndex: 0,
      type: "player.connected", occurredAt: new Date("2026-07-06T12:01:00Z"),
      payload: { gamertag, dayzId: `${svc2}-ONE=` },
    });

    await setCursor(db, consumer, 0);
    let applied = 0;
    for (let i = 0; i < 5; i++) {
      const r = await projectorTick(db, { batchSize: 100, consumerName: consumer });
      applied += r.applied;
      if (r.applied === 0) break;
    }
    expect(applied).toBeGreaterThanOrEqual(2);

    // Rebuild wipes everything and resets the cursor; re-folding from 0 must reproduce
    // the same end state: one global player row, two per-server life rows.
    await rebuildAll(db, consumer);
    let applied2 = 0;
    for (let i = 0; i < 5; i++) {
      const r = await projectorTick(db, { batchSize: 100, consumerName: consumer });
      applied2 += r.applied;
      if (r.applied === 0) break;
    }
    expect(applied2).toBeGreaterThanOrEqual(2);

    const playerRows = await db.select().from(players).where(eq(players.gamertag, gamertag));
    expect(playerRows.length).toBe(1);

    const lifeRows = await db.select().from(lives).where(eq(lives.playerId, playerRows[0]!.id));
    expect(lifeRows.length).toBe(2);
    const serverIds = new Set(lifeRows.map((l) => l.serverId));
    expect(serverIds.size).toBe(2);
    for (const l of lifeRows) {
      expect(l.lifeNumber).toBe(1);
    }
  });

  it("death_verdicts is not in REBUILD_TRUNCATE_TABLES and is emptied by the cascade", async () => {
    // Created by migration 0040 in the release that ships it: naming it here would abort the
    // rebuild phase, which runs before migrate (the v0.42.1 deploy bug). TRUNCATE lives CASCADE
    // reaches it, and the queue, through their foreign keys.
    for (const t of ["death_verdicts", "death_verdict_queue", "death_verdict_overrides"]) {
      expect(REBUILD_TRUNCATE_TABLES as readonly string[]).not.toContain(t);
    }
    const [s] = await db.insert(servers).values({ nitradoServiceId: svc + 7, name: "rebuild-verdicts" }).returning();
    const [p] = await db.insert(players).values({ gamertag: `DV-${svc}`, dayzId: `DV=${svc}` }).returning();
    const [l] = await db.insert(lives).values({
      serverId: s!.id, playerId: p!.id, lifeNumber: 1, startedAt: new Date("2031-01-01T00:00:00Z"), endedAt: new Date("2031-01-01T01:00:00Z"),
    }).returning();
    await db.insert(deathVerdicts).values({
      lifeId: l!.id, classifierVersion: 1, settledBy: "file", deathFileId: 1, deathLineIndex: 1, deathAt: new Date(),
      cause: "fall", confidence: "definitive", mechanismStated: true, rule: "B03",
    });
    await db.execute(dsql`INSERT INTO death_verdict_queue (life_id) VALUES (${l!.id})`);
    await db.execute(dsql`INSERT INTO death_verdict_overrides (server_id, death_file_id, death_line_index, cause, note, created_by)
      VALUES (${s!.id}, 1, 1, 'fall', 'durable', 'test')`);
    expect(await db.select().from(deathVerdicts)).toHaveLength(1);
    await rebuildAll(db, `rb-dv-${svc}`);
    expect(await db.select().from(deathVerdicts)).toHaveLength(0);
    expect((await db.execute(dsql`SELECT 1 FROM death_verdict_queue`)) as unknown as unknown[]).toHaveLength(0);
    // overrides are durable: keyed on the death line, they survive the rebuild
    expect((await db.execute(dsql`SELECT 1 FROM death_verdict_overrides`)) as unknown as unknown[]).toHaveLength(1);
    await db.execute(dsql`DELETE FROM death_verdict_overrides`);
  });

  it("kills is truncated and trap rows return after the sweep", async () => {
    // ⚠️ invented lines: Other Two sets a wire; two days later Victim One trips it.
    await db.execute(dsql`TRUNCATE kills, lives, players, events, raw_lines, adm_files, servers RESTART IDENTITY CASCADE`);
    const V = { name: "Victim One", id: fakeId("1") }, O = { name: "Other Two", id: fakeId("2") };
    const [s] = await db.insert(servers).values({ nitradoServiceId: svc + 9, name: "rebuild-trap" }).returning();
    await seedAdmLog(db, s!.id, [
      { date: "2031-06-08", start: "08:00:00", lines: [["08:05:00", line.connected(O, 1001.5)], ["08:10:00", line.wire(O, 1001.5)]] },
      { date: "2031-06-10", start: "12:00:00", complete: true, lines: [
        ["12:01:00", line.connected(V)], ["12:20:00", line.trip(V)], ["12:20:04", line.fragBlast(V)], ["12:20:04", line.fragKill(V)],
      ] },
    ]);
    const consumer = `rb-trap-${svc}`;
    const fold = async () => {
      await setCursor(db, consumer, 0);
      for (let i = 0; i < 20; i++) if ((await projectorTick(db, { batchSize: 500, consumerName: consumer })).applied === 0) break;
    };
    const log = { info: () => {}, warn: () => {}, error: () => {} };
    const trapRows = () => db.select().from(kills).where(eq(kills.basis, "trap_placement"));
    await fold();
    await sweepVerdicts(db, { log, trapKillsWrite: true, now: new Date("2031-06-11T00:00:00Z") });
    expect(await trapRows()).toMatchObject([{ killerGamertag: O.name, victimGamertag: V.name, weapon: "Tripwire" }]);

    await rebuildAll(db, consumer);
    expect(await db.select().from(kills)).toHaveLength(0);
    expect(await db.select().from(deathVerdicts)).toHaveLength(0);
    await fold();
    // folded again: the kill-line rows return with the fold, the trap row only with the sweep
    expect(await trapRows()).toHaveLength(0);
    await sweepVerdicts(db, { log, trapKillsWrite: true, now: new Date("2031-06-11T00:00:00Z") });
    const [l] = await db.select().from(lives).where(eq(lives.lifeNumber, 1)).orderBy(lives.id);
    const rows = await trapRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.victimLifeId).not.toBeNull();
    expect(l).toBeDefined();
  });
});
