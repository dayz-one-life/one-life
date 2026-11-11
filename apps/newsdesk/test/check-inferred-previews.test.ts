import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, playerGamertags, kills } from "@onelife/db";
import { PUBLIC_INFERRED } from "@onelife/death-verdict";
import { eq, inArray, sql as dsql } from "drizzle-orm";
import { checkInferredPreviews, isLocalDatabase, parseArgs } from "../scripts/check-inferred-previews.js";
import type { CompletionClient } from "../src/generate.js";
import { seedVerdict } from "./verdict.js";

/** ⚠️ Invented players, lives and prose only. The real run is the operator's, with a model key. */
const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 54e7;
const t0 = new Date("2031-09-01T00:00:00Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3600_000);
let serverId: number;
const pids: number[] = [];
const mine: number[] = [];

async function seed(tag: string, v: Parameters<typeof seedVerdict>[2], playerOut?: { id: number }) {
  const [p] = await db.insert(players).values({ gamertag: tag }).returning();
  if (playerOut) playerOut.id = p!.id;
  pids.push(p!.id);
  await db.insert(playerGamertags).values({ playerId: p!.id, gamertag: tag, firstSeenAt: hrs(0), lastSeenAt: hrs(0) });
  const [l] = await db.insert(lives).values({ serverId, playerId: p!.id, lifeNumber: 1, startedAt: hrs(0), endedAt: hrs(2), deathCause: "died", playtimeSeconds: 7200 }).returning();
  await seedVerdict(db, l!.id, v);
  mine.push(l!.id);
  return l!.id;
}

let cold: number, ko: number, stated: number, switchedOff: number, unknown: number, placerLife: number;
beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "ci", map: "chernarusplus", slug: `ci-${svc}`, active: true }).returning();
  serverId = s!.id;
  cold = await seed(`ci-cold-${svc}`, { cause: "cold_exposure", confidence: "inferred", mechanismStated: false, rule: "B20" });
  ko = await seed(`ci-ko-${svc}`, { cause: "unconscious_logout", upstreamCause: "infected", upstreamConfidence: "inferred", rule: "B11" });
  stated = await seed(`ci-fall-${svc}`, { cause: "fall", confidence: "definitive", rule: "A01" });
  // The control: an inferred row the reader does NOT show inferred (its family is switched off
  // during the tests), so the shown-inferred filter is what keeps it out of the inferred group.
  switchedOff = await seed(`ci-ill-${svc}`, { cause: "pneumonia", confidence: "inferred", mechanismStated: false, rule: "B21" });
  unknown = await seed(`ci-unk-${svc}`, { cause: "unknown", confidence: "unknown", rule: "Z99" });
  const victim = await seed(`ci-victim-${svc}`, { cause: "fall", confidence: "definitive", rule: "A01" });
  const placer = { id: 0 };
  placerLife = await seed(`ci-placer-${svc}`, { cause: "fall", confidence: "definitive", rule: "A01" }, placer);
  await db.insert(kills).values({
    serverId, killerGamertag: `ci-placer-${svc}`, killerPlayerId: placer.id, victimGamertag: `ci-victim-${svc}`, victimLifeId: victim,
    weapon: "Tripwire", occurredAt: hrs(1), basis: "trap_placement", creditSource: "classifier",
  });
});
beforeEach(() => { PUBLIC_INFERRED.illness = false; });
afterEach(() => { PUBLIC_INFERRED.illness = true; });
afterAll(async () => {
  await db.delete(kills).where(eq(kills.serverId, serverId));
  await db.delete(lives).where(eq(lives.serverId, serverId));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("check-inferred-previews", () => {
  it("drafts each inferred life N times and prints every rejection with its rule and sentence; writes nothing", async () => {
    const before = ((await db.execute(dsql`SELECT count(*) AS n FROM articles`)) as unknown as { n: string }[])[0]!.n;
    let n = 0;
    const client: CompletionClient = {
      complete: async () => {
        n++;
        // every other draft states the cause flatly
        const lede = n % 2 ? "He most likely froze, by every sign." : "He froze.";
        return JSON.stringify({ headline: "A Quiet End", lede, body: "B", pullQuote: null, tags: [] });
      },
    };
    const out: string[] = [];
    const r = await checkInferredPreviews(db, { drafts: 3, lives: null, only: ["inferred"] }, { client, out: (l) => out.push(l) });
    const text = out.join("\n");
    // Other suites' lives may be present; only ours are asserted.
    expect(text).toContain(`life ${cold} draft 3`);
    expect(text).toContain(`life ${ko} draft 1`);
    expect(text).not.toContain(`life ${switchedOff} `);
    expect(text).not.toContain(`life ${stated} `);
    expect(text).toMatch(/rule 4 \(lede, no hedge\): He froze\./);
    expect(r.drafts).toBe(r.lives * 3);
    expect(r.rejected).toBeGreaterThan(0);
    const after = ((await db.execute(dsql`SELECT count(*) AS n FROM articles`)) as unknown as { n: string }[])[0]!.n;
    expect(after).toBe(before);
  });

  it("also drafts deaths shown with no cause (rule 2) and trap-setters (rule 6), and sends the recent-prose block", async () => {
    const seen: string[] = [];
    const client: CompletionClient = {
      complete: async ({ user }) => { seen.push(user); return JSON.stringify({ headline: "A Quiet End", lede: "Two hours, then nothing.", body: "B", pullQuote: null, tags: [] }); },
    };
    const out: string[] = [];
    // A published obituary for the do-not-reuse block.
    await db.execute(dsql`INSERT INTO articles (kind, status, slug, headline, lede) VALUES ('obituary', 'published', ${`ci-recent-${svc}`}, 'A Headline To Avoid', 'Some lede.')`);
    try {
      const r = await checkInferredPreviews(db, { drafts: 1, lives: null, sample: 10000 }, { client, out: (l) => out.push(l) });
      const text = out.join("\n");
      const section = (g: string) => {
        const start = text.indexOf(`=== ${g} ===`);
        const next = text.indexOf("\n=== ", start + 1);
        return text.slice(start, next < 0 ? undefined : next);
      };
      expect(section("unknown")).toContain(`life ${unknown} draft 1`);
      expect(section("unknown")).toContain(`life ${switchedOff} draft 1`);
      expect(section("traps")).toContain(`life ${placerLife} draft 1`);
      expect(section("traps")).not.toContain(`life ${stated} `);
      expect(r.byGroup.unknown.lives).toBeGreaterThan(0);
      expect(r.byGroup.traps.lives).toBeGreaterThan(0);
      expect(seen.every((u) => u.includes("A Headline To Avoid"))).toBe(true);
    } finally {
      await db.execute(dsql`DELETE FROM articles WHERE slug = ${`ci-recent-${svc}`}`);
    }
  });

  it("refuses anything but a local *_test database, production's shape included, and parses its arguments", () => {
    expect(isLocalDatabase("postgres://127.0.0.1:5434/onelife_test")).toBe(true);
    expect(isLocalDatabase("postgres://onelife:x@127.0.0.1:5432/onelife")).toBe(false); // production's shape
    expect(isLocalDatabase("postgres://localhost/onelife")).toBe(false);
    expect(isLocalDatabase("postgres://db.example.com:5432/onelife_test")).toBe(false);
    expect(parseArgs(["--", "--drafts", "2", "--life", "7"])).toEqual({ drafts: 2, sample: 10, only: null, lives: [7], seed: false });
    expect(parseArgs(["--seed", "--only", "traps", "--sample", "4"])).toEqual({ drafts: 3, sample: 4, only: ["traps"], lives: null, seed: true });
    expect(() => parseArgs(["--drafts", "0"])).toThrow();
    expect(() => parseArgs(["--only", "everything"])).toThrow();
  });
});
