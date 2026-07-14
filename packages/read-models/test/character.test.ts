import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, rptFiles, characterSightings, characters } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { getLifeCharacter } from "../src/character.js";

const { db, sql } = getTestDb();
const T = (iso: string) => new Date(iso);
let serverId: number;
let rptFileId: number;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: 992001, name: "char" }).returning();
  serverId = s!.id;
  const [f] = await db.insert(rptFiles).values({ serverId, path: "/c/a.RPT", name: "a.RPT" }).returning();
  rptFileId = f!.id;
  await db.insert(characters).values({ serverId, charId: 3, uid: "U1", characterClass: "SurvivorM_Cyril", firstSeenAt: T("2026-07-11T10:00:00Z"), lastSeenAt: T("2026-07-11T15:00:00Z") });
  await db.insert(characterSightings).values([
    { serverId, rptFileId, lineIndex: 1, uid: "U1", gamertag: "YrJustBad", charId: 3, kind: "existing", characterClass: "SurvivorM_Cyril", observedAt: T("2026-07-11T11:00:00Z") },
    { serverId, rptFileId, lineIndex: 2, uid: "U1", gamertag: "YrJustBad", charId: 3, kind: "existing", characterClass: null, observedAt: T("2026-07-11T12:00:00Z") },
  ]);
});
afterAll(async () => { await sql.end(); });

describe("getLifeCharacter", () => {
  it("resolves an exact character (class from rollup, name/gender from roster)", async () => {
    const c = await getLifeCharacter(db, serverId, "YrJustBad", T("2026-07-11T10:30:00Z"), T("2026-07-11T13:00:00Z"));
    expect(c).toMatchObject({ charId: 3, characterClass: "SurvivorM_Cyril", name: "Cyril", gender: "male", confidence: "exact" });
    expect(c!.sightings).toBe(2);
  });

  it("returns null when no sighting falls in the window", async () => {
    expect(await getLifeCharacter(db, serverId, "YrJustBad", T("2026-07-10T00:00:00Z"), T("2026-07-10T01:00:00Z"))).toBeNull();
  });

  it("flags ambiguous when two charIds fall in one window, picking the most-sighted", async () => {
    await db.insert(characterSightings).values({ serverId, rptFileId, lineIndex: 3, uid: "U1", gamertag: "YrJustBad", charId: 5, kind: "new", characterClass: null, observedAt: T("2026-07-11T12:30:00Z") });
    const c = await getLifeCharacter(db, serverId, "YrJustBad", T("2026-07-11T10:30:00Z"), T("2026-07-11T13:00:00Z"));
    expect(c!.confidence).toBe("ambiguous");
    expect(c!.charId).toBe(3);
  });
});
