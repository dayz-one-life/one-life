import { describe, it, expect, afterAll } from "vitest";
import { servers, admFiles, characterSightings } from "@onelife/db";
import { eq } from "drizzle-orm";
import type { AdmFileRef } from "@onelife/nitrado";
import { ingestSweep } from "../src/sweep.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
afterAll(async () => { await sql.end(); });

// A resolved RPT login for charID 3 then a reconnect → two sightings (mirrors rpt.test.ts).
const UID = "C87349CA0FCDDE3EAAE617E3E3349B013DD71F0A";
const RPT_CONTENT =
  "Current time:  2026/07/11 11:38:05\nVersion 1.29.163047\n\n" +
  [
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
const noopClient = {
  listAdmFiles: async (): Promise<AdmFileRef[]> => [],
  listRptFiles: async (): Promise<AdmFileRef[]> => [],
  downloadFile: async (): Promise<string> => "",
};

const ADM = 'AdminLog started on 2026-07-06 at 10:00:00\n10:00:05 | Player "A" (id=A=) is connected';
const admFile = (serviceId: number): AdmFileRef => ({
  path: `/s/${serviceId}.ADM`,
  name: "DayZServer_X1_x64_2026-07-06_10-00-00.ADM",
  localTimestampMs: Date.UTC(2026, 6, 6, 10, 0, 0),
  modifiedAtMs: Date.UTC(2026, 6, 6, 14, 0, 0),
});

// Return files only for the given owned IDs; a no-op client for anything else, so a
// sibling test file's active servers (shared onelife_test DB) are never touched.
const clientForOwning = (owned: Set<number>) => (serviceId: number) => ({
  listAdmFiles: async (): Promise<AdmFileRef[]> => (owned.has(serviceId) ? [admFile(serviceId)] : []),
  listRptFiles: async (): Promise<AdmFileRef[]> => [],
  downloadFile: async (): Promise<string> => ADM,
});

describe("ingestSweep", () => {
  it("ingests every active server and skips inactive ones", async () => {
    const [a] = await db.insert(servers).values({ nitradoServiceId: 900001, name: "active-1", active: true }).returning();
    const [b] = await db.insert(servers).values({ nitradoServiceId: 900002, name: "active-2", active: true }).returning();
    const [c] = await db.insert(servers).values({ nitradoServiceId: 900003, name: "inactive", active: false }).returning();

    await ingestSweep(db, {
      clientFor: clientForOwning(new Set([900001, 900002])),
      backfillBudget: 15,
      charStaleHours: 72,
    });

    const rowsFor = async (serverId: number) =>
      (await db.select().from(admFiles).where(eq(admFiles.serverId, serverId))).length;
    expect(await rowsFor(a!.id)).toBe(1); // active → ingested
    expect(await rowsFor(b!.id)).toBe(1); // active → ingested
    expect(await rowsFor(c!.id)).toBe(0); // inactive → skipped
  });

  it("runs the RPT pass per server and returns total sightings", async () => {
    const [s] = await db.insert(servers).values({ nitradoServiceId: 900010, name: "rpt-active", active: true }).returning();
    const rptClient = {
      listAdmFiles: async (): Promise<AdmFileRef[]> => [],
      listRptFiles: async (): Promise<AdmFileRef[]> => [{ path: "/r/live.RPT", name: "live.RPT", localTimestampMs: 2000, modifiedAtMs: 2000 }],
      downloadFile: async (): Promise<string> => RPT_CONTENT,
    };

    const result = await ingestSweep(db, {
      clientFor: (sid) => (sid === 900010 ? rptClient : noopClient),
      backfillBudget: 15,
      charStaleHours: 72,
      now: new Date("2026-07-11T20:00:00Z"),
    });

    const mine = await db.select().from(characterSightings).where(eq(characterSightings.serverId, s!.id));
    expect(mine).toHaveLength(2); // RPT pass ran for this active server
    expect(result.sightings).toBe(2); // summed into the return value
  });

  it("isolates a failing server so the others still ingest", async () => {
    const [x] = await db.insert(servers).values({ nitradoServiceId: 900020, name: "boom", active: true }).returning();
    const [y] = await db.insert(servers).values({ nitradoServiceId: 900021, name: "ok", active: true }).returning();
    const boomClient = {
      listAdmFiles: async (): Promise<AdmFileRef[]> => { throw new Error("nitrado down"); },
      listRptFiles: async (): Promise<AdmFileRef[]> => [],
      downloadFile: async (): Promise<string> => "",
    };
    const okClient = {
      listAdmFiles: async (): Promise<AdmFileRef[]> => [admFile(900021)],
      listRptFiles: async (): Promise<AdmFileRef[]> => [],
      downloadFile: async (): Promise<string> => ADM,
    };
    const errored: number[] = [];

    await expect(
      ingestSweep(db, {
        clientFor: (sid) => (sid === 900020 ? boomClient : sid === 900021 ? okClient : noopClient),
        backfillBudget: 15,
        charStaleHours: 72,
        onServerError: (serverId) => errored.push(serverId),
      }),
    ).resolves.toBeDefined(); // the sweep does NOT throw

    const rowsFor = async (serverId: number) =>
      (await db.select().from(admFiles).where(eq(admFiles.serverId, serverId))).length;
    expect(await rowsFor(y!.id)).toBe(1); // healthy server still ingested
    expect(errored).toContain(x!.id); // failure surfaced, not swallowed silently
  });
});
