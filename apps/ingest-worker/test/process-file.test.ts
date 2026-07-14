import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, admFiles, rawLines, events } from "@onelife/db";
import { eq, and } from "drizzle-orm";
import { processFile } from "../src/process-file.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
let serverId: number;
let admFileId: number;

const CONTENT = [
  "AdminLog started on 2026-07-06 at 12:51:59",
  '12:52:38 | Player "Steveo12491" (id=D0= ) is connecting',
  '12:56:51 | Player "Steveo12491" (id=D0= pos=<235.7, 2924.6, 107.3>) performed EmoteSalute',
  '13:00:00 | Player "Steveo12491" (id=D0=) has been disconnected',
].join("\n");

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: 999002, name: "pf" }).returning();
  serverId = s!.id;
  const [f] = await db.insert(admFiles).values({ serverId, path: "/pf/a.ADM", name: "a.ADM" }).returning();
  admFileId = f!.id;
});
afterAll(async () => { await sql.end(); });

describe("processFile", () => {
  it("writes raw lines and events with UTC-offset timestamps, and is idempotent", async () => {
    const offsetMs = 4 * 3600_000; // server local is UTC-4 => +4h to reach UTC
    const cursor1 = await processFile(db, { serverId, admFileId, content: CONTENT, cursor: 0, fallbackDate: new Date("2026-07-06T00:00:00Z"), offsetMs });
    expect(cursor1).toBe(4);

    const raws = await db.select().from(rawLines).where(eq(rawLines.admFileId, admFileId));
    expect(raws.length).toBe(4); // header line stored too (lossless)

    const evs = await db.select().from(events).where(eq(events.admFileId, admFileId));
    const types = evs.map((e) => e.type).sort();
    expect(types).toContain("player.connecting");
    expect(types).toContain("emote.performed");
    expect(types).toContain("player.disconnected");
    expect(types).toContain("server.rebooted");

    // emote occurred at 12:56:51 local + 4h = 16:56:51 UTC
    const emote = evs.find((e) => e.type === "emote.performed")!;
    expect(new Date(emote.occurredAt).toISOString()).toBe("2026-07-06T16:56:51.000Z");

    // Re-run from cursor 0 (overlap): no duplicate raw lines or events.
    const cursor2 = await processFile(db, { serverId, admFileId, content: CONTENT, cursor: 0, fallbackDate: new Date("2026-07-06T00:00:00Z"), offsetMs });
    expect(cursor2).toBe(4);
    const raws2 = await db.select().from(rawLines).where(eq(rawLines.admFileId, admFileId));
    expect(raws2.length).toBe(4);
  });

  it("clamps cursor beyond line count (file shrank)", async () => {
    const [f] = await db.insert(admFiles).values({ serverId, path: "/pf/b.ADM", name: "b.ADM" }).returning();
    const cursor = await processFile(db, { serverId, admFileId: f!.id, content: "one\ntwo", cursor: 99, fallbackDate: new Date("2026-07-06T00:00:00Z"), offsetMs: 0 });
    expect(cursor).toBe(2);
    const raws = await db.select().from(rawLines).where(eq(rawLines.admFileId, f!.id));
    expect(raws.length).toBe(0); // nothing reprocessed
  });

  it("captures newly-appended lines across polls on a newline-terminated file (regression)", async () => {
    const [f] = await db.insert(admFiles).values({ serverId, path: "/pf/grow.ADM", name: "grow.ADM" }).returning();
    const fid = f!.id;
    const common = { serverId, admFileId: fid, fallbackDate: new Date("2026-07-06T00:00:00Z"), offsetMs: 0 };
    const poll1 = 'AdminLog started on 2026-07-06 at 10:00:00\n10:00:05 | Player "A" (id=A=) is connected\n';
    const c1 = await processFile(db, { ...common, content: poll1, cursor: 0 });
    const poll2 = poll1 + '10:00:10 | Player "A" (id=A=) has been disconnected\n';
    await processFile(db, { ...common, content: poll2, cursor: c1 });
    const evs = await db.select().from(events).where(eq(events.admFileId, fid));
    const types = evs.map((e) => e.type);
    expect(types).toContain("player.connected");
    expect(types).toContain("player.disconnected"); // the appended line MUST be captured
  });
});
