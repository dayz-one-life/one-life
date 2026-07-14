import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, admFiles, events } from "@onelife/db";
import { eq, and } from "drizzle-orm";
import type { AdmFileRef } from "@onelife/nitrado";
import { ingestTick } from "../src/tick.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
let serverId: number;

const older: AdmFileRef = { path: "/s/old.ADM", name: "DayZServer_X1_x64_2026-07-05_10-00-00.ADM", localTimestampMs: Date.UTC(2026,6,5,10,0,0), modifiedAtMs: Date.UTC(2026,6,5,14,0,0) };
const newer: AdmFileRef = { path: "/s/new.ADM", name: "DayZServer_X1_x64_2026-07-06_10-00-00.ADM", localTimestampMs: Date.UTC(2026,6,6,10,0,0), modifiedAtMs: Date.UTC(2026,6,6,14,0,0) };

const contentFor = (p: string) =>
  p === "/s/old.ADM"
    ? 'AdminLog started on 2026-07-05 at 10:00:00\n10:00:05 | Player "A" (id=A=) is connected'
    : 'AdminLog started on 2026-07-06 at 10:00:00\n10:00:05 | Player "B" (id=B=) is connected';

const client = {
  listAdmFiles: async (): Promise<AdmFileRef[]> => [older, newer], // oldest-first
  downloadFile: async (p: string) => contentFor(p),
};

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: 999003, name: "tick" }).returning();
  serverId = s!.id;
});
afterAll(async () => { await sql.end(); });

describe("ingestTick", () => {
  it("processes files oldest-first, marks older complete, keeps newest live, sets clock offset", async () => {
    await ingestTick(db, { serverId, client, backfillBudget: 15 });

    const files = await db.select().from(admFiles).where(eq(admFiles.serverId, serverId));
    const old = files.find((f) => f.path === "/s/old.ADM")!;
    const nw = files.find((f) => f.path === "/s/new.ADM")!;
    expect(old.isComplete).toBe(true);
    expect(nw.isComplete).toBe(false);
    expect(old.lastProcessedLine).toBe(2);
    expect(nw.lastProcessedLine).toBe(2);

    const [srv] = await db.select().from(servers).where(eq(servers.id, serverId));
    expect(srv!.clockOffsetMs).toBe(4 * 3600_000); // derived +4h
  });

  it("is idempotent across repeated ticks", async () => {
    await ingestTick(db, { serverId, client, backfillBudget: 15 });
    const files = await db.select().from(admFiles).where(eq(admFiles.serverId, serverId));
    expect(files.length).toBe(2); // no duplicate file rows
  });

  it("processes the sole file on a brand-new server's first tick and keeps it live", async () => {
    const [s] = await db.insert(servers).values({ nitradoServiceId: 999004, name: "tick-single" }).returning();
    const soloServerId = s!.id;

    const solo: AdmFileRef = { path: "/s/solo.ADM", name: "DayZServer_X1_x64_2026-07-06_10-00-00.ADM", localTimestampMs: Date.UTC(2026,6,6,10,0,0), modifiedAtMs: Date.UTC(2026,6,6,14,0,0) };
    const soloClient = {
      listAdmFiles: async (): Promise<AdmFileRef[]> => [solo],
      downloadFile: async () => 'AdminLog started on 2026-07-06 at 10:00:00\n10:00:05 | Player "A" (id=A=) is connected',
    };

    await ingestTick(db, { serverId: soloServerId, client: soloClient, backfillBudget: 15 });

    const files = await db.select().from(admFiles).where(eq(admFiles.serverId, soloServerId));
    expect(files.length).toBe(1);
    const file = files[0]!;
    expect(file.isComplete).toBe(false);
    expect(file.lastProcessedLine).toBe(2);

    const evts = await db.select().from(events).where(and(eq(events.serverId, soloServerId), eq(events.type, "player.connected")));
    expect(evts.length).toBeGreaterThanOrEqual(1);
  });
});
