import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, playerGamertags } from "@onelife/db";
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

async function seed(tag: string, v: Parameters<typeof seedVerdict>[2]) {
  const [p] = await db.insert(players).values({ gamertag: tag }).returning();
  pids.push(p!.id);
  await db.insert(playerGamertags).values({ playerId: p!.id, gamertag: tag, firstSeenAt: hrs(0), lastSeenAt: hrs(0) });
  const [l] = await db.insert(lives).values({ serverId, playerId: p!.id, lifeNumber: 1, startedAt: hrs(0), endedAt: hrs(2), deathCause: "died", playtimeSeconds: 7200 }).returning();
  await seedVerdict(db, l!.id, v);
  mine.push(l!.id);
  return l!.id;
}

let cold: number, ko: number, stated: number;
beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "ci", map: "chernarusplus", slug: `ci-${svc}`, active: true }).returning();
  serverId = s!.id;
  cold = await seed(`ci-cold-${svc}`, { cause: "cold_exposure", confidence: "inferred", mechanismStated: false, rule: "B20" });
  ko = await seed(`ci-ko-${svc}`, { cause: "unconscious_logout", upstreamCause: "infected", upstreamConfidence: "inferred", rule: "B11" });
  stated = await seed(`ci-fall-${svc}`, { cause: "fall", confidence: "definitive", rule: "A01" });
});
afterAll(async () => {
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
    const r = await checkInferredPreviews(db, { drafts: 3, lives: null }, { client, out: (l) => out.push(l) });
    const text = out.join("\n");
    // Other suites' lives may be present; only ours are asserted.
    expect(text).toContain(`life ${cold} draft 3`);
    expect(text).toContain(`life ${ko} draft 1`);
    expect(text).not.toContain(`life ${stated} `);
    expect(text).toMatch(/rule 4 \(lede, no hedge\): He froze\./);
    expect(r.drafts).toBe(r.lives * 3);
    expect(r.rejected).toBeGreaterThan(0);
    const after = ((await db.execute(dsql`SELECT count(*) AS n FROM articles`)) as unknown as { n: string }[])[0]!.n;
    expect(after).toBe(before);
  });

  it("refuses anything but a local database, and parses its arguments", () => {
    expect(isLocalDatabase("postgres://u:p@127.0.0.1:5434/onelife_test")).toBe(true);
    expect(isLocalDatabase("postgres://u:p@localhost/onelife")).toBe(true);
    expect(isLocalDatabase("postgres://u:p@db.example.com:5432/onelife")).toBe(false);
    expect(parseArgs(["--", "--drafts", "2", "--life", "7"])).toEqual({ drafts: 2, lives: [7], seed: false });
    expect(parseArgs(["--seed"])).toEqual({ drafts: 3, lives: null, seed: true });
    expect(() => parseArgs(["--drafts", "0"])).toThrow();
  });
});
