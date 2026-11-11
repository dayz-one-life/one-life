import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inArray, eq } from "drizzle-orm";
import { servers, players, lives, kills, deathVerdicts, playerGamertags } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { CLASSIFIER_VERSION } from "@onelife/death-verdict";
import {
  getPublicDeath, getPublicDeathsForLives, getPublicDeathsForArticles, getTrapCreditForVictimLife, articleKey,
  getWriterDeath, getDeathCheckHints,
} from "../src/death-verdicts.js";
import { seedVerdict } from "./support/verdicts.js";

/** ⚠️ Invented players, lives and verdicts only. */
const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 52e7;
const T0 = new Date("2031-03-01T10:00:00Z");
const at = (m: number) => new Date(T0.getTime() + m * 60_000);
let sid: number, vid: number, placerId: number;
const lifeIds: number[] = [];

async function life(n: number, o: Partial<typeof lives.$inferInsert> = {}) {
  const [l] = await db.insert(lives).values({
    serverId: sid, playerId: vid, lifeNumber: n, startedAt: at(n * 100), endedAt: at(n * 100 + 50), playtimeSeconds: 3000, ...o,
  }).returning();
  lifeIds.push(Number(l!.id));
  return { ...l!, id: Number(l!.id) };
}

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "dv", map: "chernarusplus", slug: `dv-${svc}` }).returning();
  sid = s!.id;
  const [v] = await db.insert(players).values({ gamertag: `Victim One ${svc}` }).returning();
  vid = Number(v!.id);
  const [p] = await db.insert(players).values({ gamertag: `Placer Person ${svc}` }).returning();
  placerId = Number(p!.id);
  await db.insert(playerGamertags).values([
    { playerId: vid, gamertag: `Old Name ${svc}`, firstSeenAt: T0, lastSeenAt: T0 },
    { playerId: vid, gamertag: `Victim One ${svc}`, firstSeenAt: T0, lastSeenAt: T0 },
  ]);
});
afterAll(async () => {
  await db.delete(kills).where(eq(kills.serverId, sid));
  await db.delete(deathVerdicts).where(inArray(deathVerdicts.lifeId, lifeIds));
  await db.delete(lives).where(eq(lives.serverId, sid));
  await db.delete(playerGamertags).where(inArray(playerGamertags.playerId, [vid, placerId]));
  await db.delete(players).where(inArray(players.id, [vid, placerId]));
  await db.delete(servers).where(eq(servers.id, sid));
  await sql.end();
});

describe("getPublicDeath", () => {
  it("final for a row at the current version", async () => {
    const l = await life(1, { deathCause: "died" });
    await seedVerdict(db, { lifeId: l.id, cause: "starvation", confidence: "definitive" });
    expect(await getPublicDeath(db, l)).toMatchObject({ status: "final", key: "starvation", label: "Starvation", tag: "Hunger and Thirst" });
  });

  it("final for a row at an older version", async () => {
    const l = await life(2, { deathCause: "died" });
    await seedVerdict(db, { lifeId: l.id, cause: "fall", confidence: "definitive", classifierVersion: CLASSIFIER_VERSION - 1 });
    expect(await getPublicDeath(db, l)).toMatchObject({ status: "final", label: "Fell" });
  });

  it("pending for no row", async () => {
    const l = await life(3, { deathCause: "died" });
    expect(await getPublicDeath(db, l)).toMatchObject({ status: "pending", key: "awaiting", label: "Awaiting the record", tag: null });
  });

  it("pending for a needs_review row", async () => {
    const l = await life(4, { deathCause: "infected" });
    await seedVerdict(db, { lifeId: l.id, cause: "fall", confidence: "definitive", needsReview: true });
    expect(await getPublicDeath(db, l)).toMatchObject({ status: "pending", key: "infected" });
  });

  it("null for an open life and a server_retired life", async () => {
    const open = await life(5, { endedAt: null });
    expect(await getPublicDeath(db, open)).toBeNull();
    const retired = await life(6, { endedAt: null });
    expect(await getPublicDeath(db, { ...retired, endedAt: at(700), endReason: "server_retired" })).toBeNull();
  });

  it("pending pvp carries the killer", async () => {
    const l = await life(7, { deathCause: "pvp", deathByGamertag: "Killer Four" });
    expect(await getPublicDeath(db, l)).toMatchObject({ status: "pending", killerGamertag: "Killer Four", label: "Killed by Killer Four" });
  });

  it("a final pvp row names the killer from the life, never from the verdict's attribution", async () => {
    const l = await life(8, { deathCause: "pvp", deathByGamertag: "Killer Four", deathWeapon: "M4-A1", deathDistance: 50 });
    await seedVerdict(db, { lifeId: l.id, cause: "pvp", confidence: "definitive", attrBasis: "kill_line", attrGamertag: "Someone Else", attrRole: "killer" });
    const d = (await getPublicDeath(db, l))!;
    expect(d).toMatchObject({ status: "final", killerGamertag: "Killer Four" });
    expect(JSON.stringify(d)).not.toContain("Someone Else");
  });

  it("an inferred attribution never names anyone", async () => {
    const l = await life(9, { deathCause: "died" });
    await seedVerdict(db, { lifeId: l.id, cause: "pvp", confidence: "inferred", attrBasis: "not_stated", attrGamertag: "Inferred Person", attrRole: "killer (inferred)" });
    const d = (await getPublicDeath(db, l))!;
    expect(d).toMatchObject({ label: "Likely killed", killerGamertag: null });
    expect(JSON.stringify(d)).not.toContain("Inferred Person");
  });

  it("a held-life override row (rule override, no attribution, no evidence) reads as its cause", async () => {
    const l = await life(10, { deathCause: "died" });
    await seedVerdict(db, { lifeId: l.id, cause: "drowned", confidence: "definitive", rule: "override", evidence: {} });
    expect(await getPublicDeath(db, l)).toMatchObject({ status: "final", label: "Drowned" });
  });

  it("'Shot' only for rule A14", async () => {
    const a = await life(11, { deathCause: "pvp" });
    await seedVerdict(db, { lifeId: a.id, cause: "pvp", confidence: "strong", rule: "A14", attrBasis: "not_stated" });
    expect((await getPublicDeath(db, a))!.label).toBe("Shot");
    const b = await life(12, { deathCause: "pvp" });
    await seedVerdict(db, { lifeId: b.id, cause: "pvp", confidence: "strong", rule: "A13", attrBasis: "not_stated" });
    expect((await getPublicDeath(db, b))!.label).toBe("Killed");
  });
});

describe("trap credit", () => {
  it("a trap_placement row gives the victim's death a credit with the placer's current name", async () => {
    const l = await life(20, { deathCause: "explosion" });
    await seedVerdict(db, { lifeId: l.id, cause: "explosive_trap", confidence: "definitive", objectKey: "m67_grenade", attrBasis: "placement" });
    await db.insert(kills).values({
      serverId: sid, killerGamertag: "Name When Written", killerPlayerId: placerId, victimGamertag: `Victim One ${svc}`,
      victimPlayerId: vid, victimLifeId: l.id, weapon: "Tripwire", occurredAt: l.endedAt!, basis: "trap_placement", creditSource: "classifier",
    });
    expect(await getTrapCreditForVictimLife(db, l.id)).toEqual({ gamertag: `Placer Person ${svc}`, device: "tripwire", byOperator: false });
    const d = (await getPublicDeath(db, l))!;
    expect(d.credit).toEqual({ gamertag: `Placer Person ${svc}`, basis: "trap_placement", device: "tripwire", byOperator: false });
    expect(d.sentence).toBe(`Killed by a tripwire rigged with an M67 frag grenade. Kill credited to Placer Person ${svc}.`);
    expect(d.killerGamertag).toBeNull();
  });

  it("an operator grant reads byOperator", async () => {
    const l = await life(21, { deathCause: "explosion" });
    await seedVerdict(db, { lifeId: l.id, cause: "landmine", confidence: "definitive", attrBasis: "placement" });
    await db.insert(kills).values({
      serverId: sid, killerGamertag: "x", killerPlayerId: placerId, victimGamertag: "v", victimLifeId: l.id,
      weapon: "Land mine", occurredAt: l.endedAt!, basis: "trap_placement", creditSource: "override",
    });
    expect((await getPublicDeath(db, l))!.credit).toMatchObject({ device: "land_mine", byOperator: true });
  });

  it("a placer with no kills row is never named", async () => {
    const l = await life(22, { deathCause: "explosion" });
    await seedVerdict(db, { lifeId: l.id, cause: "explosive_trap", confidence: "definitive", attrBasis: "placement", attrGamertag: "Refused Person", attrRole: "trap_owner" });
    const d = (await getPublicDeath(db, l))!;
    expect(d.credit).toBeNull();
    expect(JSON.stringify(d)).not.toContain("Refused Person");
  });
});

describe("batch and articles", () => {
  it("the batch form returns one entry per dead life", async () => {
    const a = await life(30, { deathCause: "died" });
    const b = await life(31, { endedAt: null });
    await seedVerdict(db, { lifeId: a.id, cause: "fall", confidence: "definitive" });
    const m = await getPublicDeathsForLives(db, [a, b]);
    expect([...m.keys()]).toEqual([a.id]);
  });

  it("an article resolves through a renamed gamertag", async () => {
    const l = await life(40, { deathCause: "died" });
    await seedVerdict(db, { lifeId: l.id, cause: "fall", confidence: "definitive" });
    const key = { serverId: sid, gamertag: `old name ${svc}`, lifeStartedAt: l.startedAt };
    const m = await getPublicDeathsForArticles(db, [key]);
    expect(m.get(articleKey(key))).toMatchObject({ status: "final", label: "Fell" });
  });

  it("an article whose life is pending or gone gets its frozen values", async () => {
    const l = await life(41, { deathCause: "pvp", deathByGamertag: "Killer Four" });
    const pending = { serverId: sid, gamertag: `Victim One ${svc}`, lifeStartedAt: l.startedAt };
    const gone = { serverId: sid, gamertag: `Victim One ${svc}`, lifeStartedAt: at(99_999) };
    const m = await getPublicDeathsForArticles(db, [pending, gone]);
    expect(m.size).toBe(0);
  });
});

// The obituary writer's read (death-verdict plan step 8). Used by newsdesk only; no API route.
describe("getWriterDeath", () => {
  it("null with no row, with a row held for review, and for an open life", async () => {
    const none = await life(50, { deathCause: "died" });
    expect(await getWriterDeath(db, none)).toBeNull();
    const held = await life(51, { deathCause: "died" });
    await seedVerdict(db, { lifeId: held.id, cause: "fall", confidence: "definitive", needsReview: true });
    expect(await getWriterDeath(db, held)).toBeNull();
    const open = await life(52, { endedAt: null });
    expect(await getWriterDeath(db, open)).toBeNull();
  });

  it("gives the frozen death, the writer's brief and the row's classifier version", async () => {
    const l = await life(53, { deathCause: "died" });
    await seedVerdict(db, { lifeId: l.id, cause: "starvation", confidence: "inferred", classifierVersion: CLASSIFIER_VERSION });
    const w = (await getWriterDeath(db, l))!;
    expect(w.verdictVersion).toBe(CLASSIFIER_VERSION);
    expect(w.death).toMatchObject({ status: "final", key: "starvation", certainty: "inferred", label: "Likely starvation" });
    expect(w.brief.line).toBe("most likely starved");
    expect(w.credit).toBeNull();
  });

  it("a credited trap death: the brief names the placer, the frozen death does not", async () => {
    const l = await life(54, { deathCause: "explosion" });
    await seedVerdict(db, { lifeId: l.id, cause: "explosive_trap", confidence: "definitive", objectKey: "m67_grenade", attrBasis: "placement" });
    await db.insert(kills).values({
      serverId: sid, killerGamertag: "Name When Written", killerPlayerId: placerId, victimGamertag: `Victim One ${svc}`,
      victimPlayerId: vid, victimLifeId: l.id, weapon: "Tripwire", occurredAt: l.endedAt!, basis: "trap_placement", creditSource: "classifier",
    });
    const w = (await getWriterDeath(db, l))!;
    expect(w.credit).toEqual({ gamertag: `Placer Person ${svc}`, device: "tripwire", byOperator: false });
    expect(w.brief.creditLine).toContain(`Placer Person ${svc}`);
    expect(JSON.stringify(w.death)).not.toContain("Placer Person");
    expect(w.death.credit).toBeNull();
    expect(w.death.sentence).toBe("Killed by a tripwire rigged with an M67 frag grenade.");
  });

  it("a named driver is in neither the frozen death nor the brief", async () => {
    const l = await life(55, { deathCause: "pvp", deathByGamertag: "Driver Seven", deathWeapon: "Sedan" });
    await seedVerdict(db, { lifeId: l.id, cause: "vehicle_run_over", confidence: "definitive", attrBasis: "kill_line_driver" });
    const w = (await getWriterDeath(db, l))!;
    expect(w.death.key).toBe("hit_by_vehicle_driver");
    expect(JSON.stringify(w)).not.toContain("Driver Seven");
  });

  it("a kill-line killer stays in the frozen label", async () => {
    const l = await life(56, { deathCause: "pvp", deathByGamertag: "Killer Eight", deathWeapon: "M4", deathDistance: 50 });
    await seedVerdict(db, { lifeId: l.id, cause: "pvp", confidence: "definitive", attrBasis: "kill_line" });
    const w = (await getWriterDeath(db, l))!;
    expect(w.death.killerGamertag).toBe("Killer Eight");
    expect(w.brief.line).toContain("Killer Eight");
  });
});

describe("getDeathCheckHints", () => {
  it("logoutFamily for the knock-out and logout causes, and only those; family of the stored (or upstream) cause", async () => {
    const a = await life(60, { deathCause: "died" });
    await seedVerdict(db, { lifeId: a.id, cause: "unconscious_logout", confidence: "definitive", upstreamCause: "infected", upstreamConfidence: "definitive" });
    const b = await life(61, { deathCause: "died" });
    await seedVerdict(db, { lifeId: b.id, cause: "respawn_while_unconscious", confidence: "definitive", upstreamCause: "fall", upstreamConfidence: "inferred" });
    const c = await life(62, { deathCause: "infected" });
    await seedVerdict(db, { lifeId: c.id, cause: "infected", confidence: "definitive" });
    const d = await life(63, { deathCause: "died" });
    const e = await life(64, { deathCause: "died" });
    await seedVerdict(db, { lifeId: e.id, cause: "restrained_logout", confidence: "definitive" });
    expect(await getDeathCheckHints(db, e.id)).toEqual({ logoutFamily: true, family: null });
    expect(await getDeathCheckHints(db, a.id)).toEqual({ logoutFamily: true, family: "infected" });
    expect(await getDeathCheckHints(db, b.id)).toEqual({ logoutFamily: true, family: null });
    expect(await getDeathCheckHints(db, c.id)).toEqual({ logoutFamily: false, family: "infected" });
    expect(await getDeathCheckHints(db, d.id)).toEqual({ logoutFamily: false, family: null });
    // A switched-off or unknown-certainty inferred cause still reports its internal family.
    const f = await life(65, { deathCause: "died" });
    await seedVerdict(db, { lifeId: f.id, cause: "cold_exposure", confidence: "inferred" });
    expect(await getDeathCheckHints(db, f.id)).toEqual({ logoutFamily: false, family: "exposure" });
  });
});
