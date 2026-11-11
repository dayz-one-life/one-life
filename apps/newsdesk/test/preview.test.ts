import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, articles, playerGamertags } from "@onelife/db";
import { eq, inArray, sql as dsql } from "drizzle-orm";
import { parsePreviewArgs, runPreview } from "../src/preview.js";
import type { CompletionClient } from "../src/generate.js";
import { seedVerdict } from "./verdict.js";

/** ⚠️ Invented players and lives only. */
const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 53e7;
const t0 = new Date("2031-08-01T00:00:00Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3600_000);
let serverId: number;
let withVerdict: number, without: number;
const pids: number[] = [];

async function seed(tag: string, verdict: boolean) {
  const [p] = await db.insert(players).values({ gamertag: tag }).returning();
  pids.push(p!.id);
  await db.insert(playerGamertags).values({ playerId: p!.id, gamertag: tag, firstSeenAt: hrs(0), lastSeenAt: hrs(0) });
  const [l] = await db.insert(lives).values({ serverId, playerId: p!.id, lifeNumber: 1, startedAt: hrs(0), endedAt: hrs(2), deathCause: "died", playtimeSeconds: 7200 }).returning();
  if (verdict) await seedVerdict(db, l!.id, { cause: "starvation", confidence: "inferred", mechanismStated: false, rule: "B20" });
  return l!.id;
}

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "pv", map: "chernarusplus", slug: `pv-${svc}`, active: true }).returning();
  serverId = s!.id;
  withVerdict = await seed(`pv-a-${svc}`, true);
  without = await seed(`pv-b-${svc}`, false);
});
afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(lives).where(eq(lives.serverId, serverId));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

const count = async () => Number(((await db.execute(dsql`SELECT count(*) AS n FROM articles`)) as unknown as { n: string }[])[0]!.n);

describe("parsePreviewArgs", () => {
  it("takes repeatable --life and --generate", () => {
    expect(parsePreviewArgs(["--", "--life", "3", "--life", "9", "--generate"])).toEqual({ lives: [3, 9], generate: true });
    expect(() => parsePreviewArgs([])).toThrow(/usage/);
    expect(() => parsePreviewArgs(["--life", "x"])).toThrow();
  });
});

describe("preview", () => {
  it("prints a prompt and writes no row", async () => {
    const before = await count();
    const out: string[] = [];
    const missed = await runPreview(db, { lives: [withVerdict], generate: false }, { client: null, out: (l) => out.push(l) });
    expect(missed).toBe(0);
    const text = out.join("\n");
    expect(text).toContain(`pv-a-${svc}`);
    expect(text).toContain("most likely starved");
    expect(await count()).toBe(before);
  });

  it("with --generate prints the draft and both checks, and still writes no row", async () => {
    const before = await count();
    const client: CompletionClient = {
      complete: async () => JSON.stringify({ headline: "Starved In The End", lede: "He starved.", body: "B", pullQuote: null, tags: [] }),
    };
    const out: string[] = [];
    await runPreview(db, { lives: [withVerdict], generate: true }, { client, out: (l) => out.push(l) });
    const text = out.join("\n");
    expect(text).toContain("Starved In The End");
    expect(text).toContain("no-place check: pass");
    expect(text).toMatch(/cause check: REJECTED/);
    expect(text).toContain("rule 4 (headline)");
    expect(await count()).toBe(before);
  });

  it("a life with no verdict, or no life at all, is reported and counted", async () => {
    const out: string[] = [];
    const missed = await runPreview(db, { lives: [without, 999_999_999], generate: false }, { client: null, out: (l) => out.push(l) });
    expect(missed).toBe(2);
    expect(out.join("\n")).toContain("no final verdict yet");
    expect(out.join("\n")).toContain("no ended life");
  });
});
