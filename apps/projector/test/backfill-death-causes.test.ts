import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, admFiles, rawLines, events } from "@onelife/db";
import { eq, and } from "drizzle-orm";
import { appendEvent } from "@onelife/event-log";
import { backfillDeathCauses } from "../src/backfill-death-causes.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 8e8;
let serverId: number;
let admFileId: number;

const WOLF_LINE = 'Player "W" (DEAD) (id=1 pos=<1.0, 2.0, 3.0>) killed by Animal_CanisLupus';
const WEIRD_LINE = 'Player "X" (DEAD) (id=2 pos=<1.0, 2.0, 3.0>) killed by BarbedWireKit';
const PVP_LINE = 'Player "V" (DEAD) (id=3) killed by Player "K" (id=4) with M4A1 from 10 meters';
const SUICIDE_LINE = 'Player "S" (DEAD) (id=5 pos=<1.0, 2.0, 3.0>) committed suicide';
// DayZ omits the (DEAD) marker on ~12% of suicide lines. The old parser dropped those, so the
// line was ingested as a position event ONLY — no death event anywhere. Its companion is the
// clauseless `died. Stats>` line DayZ writes for the same death, at the same second.
const SUICIDE_NO_DEAD_LINE = 'Player "N" (id=6 pos=<1.0, 2.0, 3.0>) committed suicide';
const COMPANION_DIED_LINE = 'Player "N" (DEAD) (id=6 pos=<1.0, 2.0, 3.0>) died. Stats> Water: 500 Energy: 400 Bleed sources: 1';
// A dropped death with NO companion: nothing to patch, and inventing an event is what breaks the
// fold — so it must be left alone and reported, never recovered.
const ORPHAN_NO_DEAD_LINE = 'Player "O" (id=7 pos=<9.0, 9.0, 9.0>) committed suicide';

async function seed(lineIndex: number, text: string, payload: Record<string, unknown>) {
  const occurredAt = new Date("2026-07-10T12:00:00Z");
  const [rl] = await db.insert(rawLines).values({ serverId, admFileId, lineIndex, text, occurredAt }).returning();
  await appendEvent(db, { serverId, admFileId, lineIndex, subIndex: 0, type: "player.died", occurredAt, payload, rawLineId: rl!.id });
  return rl!.id;
}

/** Seeds a raw line the OLD parser did not read as a death: only its position event exists. */
async function seedPositionOnly(lineIndex: number, text: string, payload: Record<string, unknown>) {
  const occurredAt = new Date("2026-07-10T12:00:00Z");
  const [rl] = await db.insert(rawLines).values({ serverId, admFileId, lineIndex, text, occurredAt }).returning();
  await appendEvent(db, { serverId, admFileId, lineIndex, subIndex: 0, type: "player.position", occurredAt, payload, rawLineId: rl!.id });
  return rl!.id;
}

let wolfRawLineId: number;
let weirdRawLineId: number;
let pvpRawLineId: number;
let suicideRawLineId: number;
let noDeadRawLineId: number;
let companionRawLineId: number;
let orphanRawLineId: number;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "backfill-death-causes-test" }).returning();
  serverId = s!.id;
  const [f] = await db.insert(admFiles).values({ serverId, path: "y.ADM", name: "y.ADM" }).returning();
  admFileId = f!.id;
  // Historical payloads: the pre-stage-2 parser flattened both non-player killers to "environment".
  wolfRawLineId = await seed(10, WOLF_LINE, { victim: "W", cause: "environment", killer: null, weapon: null, distance: null });
  weirdRawLineId = await seed(11, WEIRD_LINE, { victim: "X", cause: "environment", killer: null, weapon: null, distance: null });
  pvpRawLineId = await seed(12, PVP_LINE, { victim: "V", cause: "pvp", killer: "K", weapon: "M4A1", distance: 10 });
  suicideRawLineId = await seed(13, SUICIDE_LINE, { victim: "S", cause: "suicide", killer: null, weapon: null, distance: null });
  noDeadRawLineId = await seedPositionOnly(14, SUICIDE_NO_DEAD_LINE, { gamertag: "N", x: 1, y: 2, z: 3 });
  companionRawLineId = await seed(15, COMPANION_DIED_LINE,
    { victim: "N", cause: "died", killer: null, weapon: null, distance: null, energy: 400, water: 500, bleedSources: 1 });
  orphanRawLineId = await seedPositionOnly(16, ORPHAN_NO_DEAD_LINE, { gamertag: "O", x: 9, y: 9, z: 9 });
});

afterAll(async () => {
  await db.delete(events).where(eq(events.serverId, serverId));
  await db.delete(rawLines).where(eq(rawLines.serverId, serverId));
  await db.delete(admFiles).where(eq(admFiles.serverId, serverId));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("backfillDeathCauses", () => {
  it("upgrades environment->wolf, keeps unmapped entities as environment with a survey entry, never touches pvp", async () => {
    const { patched, unmapped, recovered, unpaired } = await backfillDeathCauses(db);
    expect(patched).toBe(2); // wolf upgrade + weird deathEntity add
    expect(recovered).toBe(1); // the marker-less suicide, applied to its companion died event
    expect(unpaired).toBe(1);  // the orphan: reported, never invented

    const wolf = (await db.select().from(events).where(eq(events.rawLineId, wolfRawLineId)))[0]!;
    expect((wolf.payload as any).cause).toBe("wolf");
    expect((wolf.payload as any).deathEntity).toBe("Animal_CanisLupus");

    const weird = (await db.select().from(events).where(eq(events.rawLineId, weirdRawLineId)))[0]!;
    expect((weird.payload as any).cause).toBe("environment");
    expect((weird.payload as any).deathEntity).toBe("BarbedWireKit");
    expect(unmapped).toEqual({ BarbedWireKit: 1 });

    const pvp = (await db.select().from(events).where(eq(events.rawLineId, pvpRawLineId)))[0]!;
    expect((pvp.payload as any).cause).toBe("pvp");
    expect((pvp.payload as any).deathEntity).toBeUndefined();

    const suicide = (await db.select().from(events).where(eq(events.rawLineId, suicideRawLineId)))[0]!;
    expect((suicide.payload as any).cause).toBe("suicide");
    expect((suicide.payload as any).deathEntity).toBeUndefined();
  });

  it("recovers a dropped death by patching its COMPANION died event, not by inserting one", async () => {
    const companion = (await db.select().from(events).where(eq(events.rawLineId, companionRawLineId)))[0]!;
    expect((companion.payload as any).cause).toBe("suicide");

    // ⚠️⚠️ The recovery must NEVER append a new event. `events.id` is the fold order, so an event
    // appended now for a historical line folds LAST — after every later event — and `onDied`
    // checks `getOpenLife` FIRST. It would therefore end the player's CURRENT life and back-date
    // it by however long ago the death was. In production 8 of the 12 recoverable lines belong to
    // players with an open life right now. Patching the companion keeps the change inside the
    // fold's existing order, where the event already sits at the right point in the stream.
    const onDroppedLine = await db.select().from(events).where(eq(events.rawLineId, noDeadRawLineId));
    expect(onDroppedLine.some((r) => r.type === "player.died")).toBe(false);
    expect(onDroppedLine.every((r) => r.type === "player.position")).toBe(true);
  });

  it("leaves a dropped death alone when it has no companion to patch", async () => {
    const rows = await db.select().from(events).where(eq(events.rawLineId, orphanRawLineId));
    expect(rows.some((r) => r.type === "player.died")).toBe(false);
    expect(rows).toHaveLength(1); // the position event only — nothing invented
  });

  it("is idempotent — a second run patches nothing and creates no events", async () => {
    const before = (await db.select().from(events).where(eq(events.serverId, serverId))).length;
    const second = await backfillDeathCauses(db);
    expect(second.patched).toBe(0);
    expect(second.recovered).toBe(0);
    expect(second.unmapped).toEqual({ BarbedWireKit: 1 }); // survey still reports, patching does not repeat
    expect(second.unpaired).toBe(1);                       // survey still reports the orphan too

    const after = (await db.select().from(events).where(eq(events.serverId, serverId))).length;
    expect(after).toBe(before); // the backfill is patch-only; it must never grow the event log
  });
});
