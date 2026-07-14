import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, rptFiles, characterSightings, characters } from "@onelife/db";
import { and, eq } from "drizzle-orm";
import { getTestDb } from "@onelife/test-support";
import { processRptContent } from "../src/rpt-process-file.js";
import { rptTick } from "../src/rpt-tick.js";

const { db, sql } = getTestDb();
const UID = "C87349CA0FCDDE3EAAE617E3E3349B013DD71F0A";
const HEADER = "Current time:  2026/07/11 11:38:05\nVersion 1.29.163047\n\n";

// One resolved login for Cyril (charID 3), then a reconnect with no model signal (class null).
const CONTENT = HEADER + [
  `14:03:04.630 [StateMachine]: Player YrJustBad (dpnid 1223205378 uid ${UID}) Entering GetLoadedCharLoginState`,
  "14:03:04.646  WORLD : Create entity type 'SurvivorM_Cyril'",
  `14:03:07.46  Player YrJustBad (id=${UID} pos=<1.0, 2.0, 3.0>) has connected.`,
  "14:03:07.46  <LOAD EXISTING CHAR>:",
  "    charID 3", "    playerID 3", "    dpnid 1223205378", `    uid ${UID}`,
  `15:10:00.0 [StateMachine]: Player YrJustBad (dpnid 9999 uid ${UID}) Entering GetLoadedCharLoginState`,
  `15:10:02.0 Player YrJustBad (id=${UID} pos=<4.0, 5.0, 6.0>) has connected.`,
  "15:10:02.0 <LOAD EXISTING CHAR>:",
  "    charID 3", "    playerID 3", "    dpnid 9999", `    uid ${UID}`,
].join("\n");

afterAll(async () => { await sql.end(); });

describe("processRptContent", () => {
  let serverId: number;
  let rptFileId: number;
  beforeAll(async () => {
    const [s] = await db.insert(servers).values({ nitradoServiceId: 991001, name: "rpt-pf" }).returning();
    serverId = s!.id;
    const [f] = await db.insert(rptFiles).values({ serverId, path: "/rpt/a.RPT", name: "a.RPT" }).returning();
    rptFileId = f!.id;
  });

  it("writes sightings + a class-resolved rollup with charID inheritance", async () => {
    const r = await processRptContent(db, { serverId, rptFileId, content: CONTENT, offsetMs: 0, charStaleHours: 72 });
    expect(r.sightings).toBe(2);
    const sights = await db.select().from(characterSightings).where(eq(characterSightings.serverId, serverId));
    expect(sights).toHaveLength(2);
    const classes = sights.map((s) => s.characterClass);
    expect(classes).toContain("SurvivorM_Cyril");
    expect(classes).toContain(null);
    const chars = await db.select().from(characters).where(eq(characters.serverId, serverId));
    expect(chars).toHaveLength(1); // one epoch for charId 3
    expect(chars[0]!.characterClass).toBe("SurvivorM_Cyril"); // inherited across both sightings
  });

  it("is idempotent on re-process", async () => {
    await processRptContent(db, { serverId, rptFileId, content: CONTENT, offsetMs: 0, charStaleHours: 72 });
    expect(await db.select().from(characterSightings).where(eq(characterSightings.serverId, serverId))).toHaveLength(2);
    expect(await db.select().from(characters).where(eq(characters.serverId, serverId))).toHaveLength(1);
  });
});

describe("rptTick", () => {
  it("processes files, marks rotated files complete and leaves the live file open", async () => {
    const [s] = await db.insert(servers).values({ nitradoServiceId: 991002, name: "rpt-tick" }).returning();
    const serverId = s!.id;
    const client = {
      async listRptFiles() {
        return [
          { path: "/r/old.RPT", name: "old.RPT", localTimestampMs: 1000, modifiedAtMs: 1000 },
          { path: "/r/live.RPT", name: "live.RPT", localTimestampMs: 2000, modifiedAtMs: 2000 },
        ];
      },
      async downloadFile() { return CONTENT; },
    };
    const r = await rptTick(db, { serverId, client, charStaleHours: 72, now: new Date("2026-07-11T20:00:00Z") });
    expect(r.files).toBe(2);
    expect(r.sightings).toBe(4); // 2 per file
    const old = await db.select().from(rptFiles).where(and(eq(rptFiles.serverId, serverId), eq(rptFiles.path, "/r/old.RPT")));
    const live = await db.select().from(rptFiles).where(and(eq(rptFiles.serverId, serverId), eq(rptFiles.path, "/r/live.RPT")));
    expect(old[0]!.isComplete).toBe(true);
    expect(live[0]!.isComplete).toBe(false);
  });
});
