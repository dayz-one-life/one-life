import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import {
  servers, players, lives, articles, articleRevisions, playerGamertags, kills, syndications, deathVerdictQueue,
} from "@onelife/db";
import { eq, inArray, sql as dsql } from "drizzle-orm";
import { getObituaryBySlug, getPublishedObituaries, type VerdictSweepBacklog } from "@onelife/read-models";
import { findSyndicationTargets } from "../../crier/src/pg-store.js";
import {
  frozenCauseOf, parseRegenerateArgs, regenerateOne, restore, runRegenerate, selectDeniedCredit, selectInferredFamily, selectStale,
  selectStaleInferred, SweepNotCaughtUpError, type RegenerateDeps,
} from "../src/regenerate.js";
import { findObituaryTargets } from "../src/pg-store.js";
import { NO_MECHANISM_DIRECTIVE } from "../src/prompt.js";
import type { CompletionClient } from "../src/generate.js";
import { seedVerdict } from "./verdict.js";
import { deathVerdicts } from "@onelife/db";

/**
 * `regenerate` against the test database, with a STUB model client: no model is ever called.
 * ⚠️ Invented players, lives and prose only.
 */
const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 54e7;
const t0 = new Date("2031-09-01T00:00:00Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3600_000);
let serverId: number;
const pids: number[] = [];
const caughtUp = async (): Promise<VerdictSweepBacklog> => ({ queued: 0, unswept: 0, foldBehind: false });
let n = 0;
const uid = () => `${svc}-${++n}`;

/** A stub model: returns `draft(call, prompt)` and records every prompt it was sent. */
function stub(draft: (call: number, user: string) => Record<string, unknown> = (c) => ({
  headline: `A Quiet Ending Number ${["One", "Two", "Three", "Four", "Five"][c] ?? "Many"}`,
  lede: `The desk files this one for the record, part ${c + 1}.`,
  body: "The life ran its course and the paper notes it.", pullQuote: null, tags: [],
})) {
  const prompts: string[] = [];
  const client: CompletionClient = { complete: async ({ user }) => { prompts.push(user); return JSON.stringify(draft(prompts.length - 1, user)); } };
  return { client, prompts };
}

function deps(client: CompletionClient | null, out: string[] = []): RegenerateDeps {
  return { client, model: "test-model", now: () => hrs(500), siteUrl: "https://example.test", out: (l) => out.push(l), sweepBacklog: caughtUp };
}

interface Seeded { lifeId: number; playerId: number; slug: string; articleId: number }

/** A dead life with an alias row, an optional verdict, and a published obituary about it. */
async function seed(opts: {
  tag?: string; articleTag?: string; deathCause?: string; playtime?: number; startH?: number; endH?: number;
  verdict?: Parameters<typeof seedVerdict>[2] | null; facts?: Record<string, unknown>; promptVersion?: string;
  tags?: string[]; headline?: string; playerId?: number; lifeNumber?: number;
}): Promise<Seeded> {
  const tag = opts.tag ?? `rg-${uid()}`;
  let playerId = opts.playerId;
  if (playerId == null) {
    const [p] = await db.insert(players).values({ gamertag: tag }).returning();
    playerId = p!.id;
    pids.push(playerId);
    await db.insert(playerGamertags).values({ playerId, gamertag: tag, firstSeenAt: hrs(0), lastSeenAt: hrs(0) });
  }
  const startH = opts.startH ?? 0;
  const [l] = await db.insert(lives).values({
    serverId, playerId, lifeNumber: opts.lifeNumber ?? 1, startedAt: hrs(startH), endedAt: hrs(opts.endH ?? startH + 2),
    deathCause: opts.deathCause ?? "died", playtimeSeconds: opts.playtime ?? 7200,
  }).returning();
  if (opts.verdict !== null) await seedVerdict(db, l!.id, opts.verdict ?? { cause: "explosive_trap", confidence: "definitive", objectKey: "m67_grenade", rule: "A06", attrBasis: "placement" });
  const slug = `rg-slug-${uid()}`;
  const [a] = await db.insert(articles).values({
    kind: "obituary", status: "published", slug, serverId, gamertag: opts.articleTag ?? tag, map: "chernarusplus",
    mapSlug: `rg-${svc}`, lifeNumber: opts.lifeNumber ?? 1, lifeStartedAt: hrs(startH), deathAt: hrs(opts.endH ?? startH + 2),
    headline: opts.headline ?? "The Old Headline", lede: "The old lede says no cause was recorded.", body: "Old body.",
    tags: opts.tags ?? ["Obituaries", "Chernarus", "Unknown"], cause: "died", attempts: 1, promptVersion: opts.promptVersion ?? "obituary-v3",
    facts: opts.facts ?? { causeCategory: "unknown", cause: "died", verdict: { cause: "unknown", confidence: "low", conditions: [] } },
    generatedAt: hrs(3), timeAliveSeconds: 7200, kills: 0,
  }).returning();
  return { lifeId: l!.id, playerId, slug, articleId: Number(a!.id) };
}

const article = async (slug: string) => (await db.select().from(articles).where(eq(articles.slug, slug)))[0]!;
const revisions = async (articleId: number) =>
  db.select().from(articleRevisions).where(eq(articleRevisions.articleId, articleId)).orderBy(articleRevisions.id);
const slugsOf = (cs: { article: { slug: string | null } }[]) => cs.map((c) => c.article.slug);

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "rg", map: "chernarusplus", slug: `rg-${svc}`, active: true }).returning();
  serverId = s!.id;
});
afterAll(async () => {
  const ids = (await db.select({ id: articles.id }).from(articles).where(eq(articles.serverId, serverId))).map((r) => Number(r.id));
  if (ids.length) await db.delete(articleRevisions).where(inArray(articleRevisions.articleId, ids));
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(kills).where(eq(kills.serverId, serverId));
  await db.delete(lives).where(eq(lives.serverId, serverId));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("parseRegenerateArgs", () => {
  it("takes one selector, --slug, --limit and --write; --restore stands alone", () => {
    expect(parseRegenerateArgs(["--", "--stale-cause", "--limit", "10", "--write"]))
      .toEqual({ selector: { kind: "stale-cause" }, slug: null, limit: 10, write: true });
    expect(parseRegenerateArgs(["--slug", "a-b"])).toEqual({ selector: { kind: "slug" }, slug: "a-b", limit: null, write: false });
    expect(parseRegenerateArgs(["--inferred-family", "exposure"]))
      .toMatchObject({ selector: { kind: "inferred-family", family: "exposure" }, write: false });
    expect(parseRegenerateArgs(["--restore", "a-b"])).toEqual({ restore: "a-b" });
    expect(() => parseRegenerateArgs([])).toThrow(/usage/);
    expect(() => parseRegenerateArgs(["--stale-cause", "--denied-credit"])).toThrow(/one selector/);
    expect(() => parseRegenerateArgs(["--inferred-family", "weather"])).toThrow(/must be one of/);
    expect(() => parseRegenerateArgs(["--restore", "a", "--write"])).toThrow(/only a slug/);
    expect(() => parseRegenerateArgs(["--stale-cause", "--limit", "0"])).toThrow(/positive/);
  });
});

describe("frozenCauseOf", () => {
  it("reads a v3 article's category and coarse word, and a v4 article's frozen death", () => {
    expect(frozenCauseOf({ facts: { causeCategory: "unknown", cause: "died" }, tags: [] })).toEqual({ unknown: true, coarse: null });
    expect(frozenCauseOf({ facts: { causeCategory: "environment", cause: "explosion" }, tags: [] })).toEqual({ unknown: false, coarse: "explosion" });
    // v3 filed a bare "died" as Environment when the old read-time guess named a mechanism: the
    // prose narrated that guess, which the record never stated.
    expect(frozenCauseOf({ facts: { causeCategory: "environment", cause: "died", verdict: { cause: "starvation", confidence: "low" } }, tags: [] }))
      .toEqual({ unknown: false, coarse: "environment" });
    expect(frozenCauseOf({ facts: { causeCategory: "environment", cause: "fall" }, tags: [] })).toEqual({ unknown: false, coarse: null });
    expect(frozenCauseOf({ facts: { death: { key: "unknown", tag: "Unknown", certainty: "unknown" } }, tags: [] }).unknown).toBe(true);
    expect(frozenCauseOf({ facts: { death: { key: "explosion", tag: "Explosion", certainty: "definitive", detail: null } }, tags: [] }).coarse).toBe("explosion");
    expect(frozenCauseOf({ facts: { death: { key: "tripwire", tag: "Trap", certainty: "definitive", detail: "M67" } }, tags: [] }))
      .toEqual({ unknown: false, coarse: null });
  });
});

describe("regenerate --slug / --stale-cause", () => {
  it("without --write nothing changes, and the dry-run prints old and new headline, lede and the check", async () => {
    const s = await seed({});
    const before = await article(s.slug);
    const m = stub();
    const out: string[] = [];
    const r = await runRegenerate(db, { selector: { kind: "slug" }, slug: s.slug, limit: null, write: false }, deps(m.client, out));
    expect(r).toMatchObject({ selected: 1, rewritten: 0, failed: 0 });
    expect(m.prompts).toHaveLength(1);
    expect(await article(s.slug)).toEqual(before);
    expect(await revisions(s.articleId)).toHaveLength(0);
    const text = out.join("\n");
    expect(text).toContain("dry-run");
    expect(text).toContain("old headline: The Old Headline");
    expect(text).toContain("new headline: A Quiet Ending Number One");
    expect(text).toContain("new lede: The desk files this one");
    expect(text).toContain("checks: pass");
  });

  it("--write swaps the prose and archives the old row; slug, status, attempts and created_at are unchanged", async () => {
    const s = await seed({});
    const before = await article(s.slug);
    const r = await runRegenerate(db, { selector: { kind: "slug" }, slug: s.slug, limit: null, write: true }, deps(stub().client));
    expect(r.rewritten).toBe(1);
    const after = await article(s.slug);
    expect(after.headline).toBe("A Quiet Ending Number One");
    expect(after).toMatchObject({ slug: before.slug, status: "published", attempts: before.attempts, createdAt: before.createdAt });
    expect(after.promptVersion).toBe("obituary-v4");
    expect(after.model).toBe("test-model");
    expect(after.generatedAt).toEqual(hrs(500));
    expect(after.verdictVersion).toBeGreaterThan(0);
    expect(after.tags!.slice(0, 3)).toEqual(["Obituaries", "Chernarus", "Trap"]);
    expect(after.cause).toBe("explosion"); // the legacy token
    expect((after.facts as { death: { key: string } }).death.key).toBe("tripwire");
    const [rev] = await revisions(s.articleId);
    expect(rev).toMatchObject({ reason: "cause-corrected" });
    expect(rev!.snapshot).toMatchObject({ headline: "The Old Headline", status: "published", promptVersion: "obituary-v3", correctedAt: null });
    // The page now carries the correction line.
    expect((await getObituaryBySlug(db, s.slug))!.correctedAt).toEqual(hrs(500));
  });

  it("the archive and the swap are one transaction: a failing update leaves no revision behind", async () => {
    const s = await seed({});
    await db.execute(dsql.raw(`CREATE OR REPLACE FUNCTION rg_block() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'blocked'; END $$ LANGUAGE plpgsql`));
    await db.execute(dsql.raw(`CREATE TRIGGER rg_block BEFORE UPDATE ON articles FOR EACH ROW WHEN (OLD.id = ${s.articleId}) EXECUTE FUNCTION rg_block()`));
    try {
      await expect(runRegenerate(db, { selector: { kind: "slug" }, slug: s.slug, limit: null, write: true }, deps(stub().client))).rejects.toThrow();
    } finally {
      await db.execute(dsql.raw(`DROP TRIGGER rg_block ON articles`));
      await db.execute(dsql.raw(`DROP FUNCTION rg_block()`));
    }
    expect(await revisions(s.articleId)).toHaveLength(0);
    expect((await article(s.slug)).headline).toBe("The Old Headline");
  });

  it("a failed generation or a failed check changes nothing", async () => {
    const s = await seed({});
    const before = await article(s.slug);
    const boom: CompletionClient = { complete: async () => { throw new Error("api boom"); } };
    const out: string[] = [];
    let r = await runRegenerate(db, { selector: { kind: "slug" }, slug: s.slug, limit: null, write: true }, deps(boom, out));
    expect(r.failed).toBe(1);
    expect(out.join("\n")).toContain("FAILED (nothing changed): api boom");
    // A draft that breaks the cause check twice (rule 3: a word never published).
    const bad = stub(() => ({ headline: "Pneumonia Took Him", lede: "L", body: "B", pullQuote: null, tags: [] }));
    r = await runRegenerate(db, { selector: { kind: "slug" }, slug: s.slug, limit: null, write: true }, deps(bad.client, out));
    expect(r.failed).toBe(1);
    expect(bad.prompts).toHaveLength(2); // the retry, then the failure
    expect(out.join("\n")).toMatch(/cause-check violation after retry: rules 3/);
    expect(await article(s.slug)).toEqual(before);
    expect(await revisions(s.articleId)).toHaveLength(0);
  });

  it("the syndications ledger is untouched and the crier finds no target", async () => {
    const s = await seed({});
    await db.insert(syndications).values([
      { slug: s.slug, channel: "discord", postedAt: hrs(4), attempts: 1 },
      { slug: s.slug, channel: "facebook", postedAt: hrs(4), attempts: 1 },
    ]);
    try {
      const ledger = await db.select().from(syndications).where(eq(syndications.slug, s.slug));
      await runRegenerate(db, { selector: { kind: "slug" }, slug: s.slug, limit: null, write: true }, deps(stub().client));
      expect(await db.select().from(syndications).where(eq(syndications.slug, s.slug))).toEqual(ledger);
      const targets = await findSyndicationTargets(db, { channels: ["discord", "facebook"], since: hrs(-1), maxAttempts: 3, limit: 100 });
      expect(targets.map((t) => t.slug)).not.toContain(s.slug);
    } finally {
      await db.delete(syndications).where(eq(syndications.slug, s.slug));
    }
  });

  it("--stale-cause selects a no-cause article and an R1-era \"explosion\" article over a tripwire, never an inferred one", async () => {
    const unknown = await seed({});
    const r1 = await seed({ deathCause: "explosion", facts: { causeCategory: "environment", cause: "explosion", verdict: { cause: "explosion", confidence: "high", conditions: [] } }, tags: ["Obituaries", "Chernarus", "Environment"] });
    const plainExplosion = await seed({
      deathCause: "explosion", verdict: { cause: "explosive_other", confidence: "definitive", rule: "A10" },
      facts: { causeCategory: "environment", cause: "explosion" }, tags: ["Obituaries", "Chernarus", "Environment"],
    });
    const inferred = await seed({ verdict: { cause: "starvation", confidence: "inferred", mechanismStated: false, rule: "B20" } });
    const current = await seed({
      verdict: { cause: "pvp", confidence: "definitive", attrBasis: "kill_line", rule: "A04" }, deathCause: "pvp",
      facts: { causeCategory: "pvp", cause: "pvp" }, tags: ["Obituaries", "Chernarus", "PvP"],
    });
    const guessed = await seed({
      facts: { causeCategory: "environment", cause: "died", verdict: { cause: "starvation", confidence: "low", conditions: [] } },
      tags: ["Obituaries", "Chernarus", "Environment"],
    });
    const picked = slugsOf(await selectStale(db));
    expect(picked).toContain(guessed.slug);
    expect(picked).toContain(unknown.slug);
    expect(picked).toContain(r1.slug);
    expect(picked).not.toContain(inferred.slug);
    expect(picked).not.toContain(current.slug);
    expect(picked).not.toContain(plainExplosion.slug); // the record says nothing more than "explosion"
    expect(slugsOf(await selectStale(db, { slug: r1.slug }))).toEqual([r1.slug]);
    expect(await selectStale(db, { limit: 1 })).toHaveLength(1);
  });

  it("the second article of a batch is told the first one's headline", async () => {
    const a = await seed({ headline: "Batch Old One" });
    const b = await seed({ headline: "Batch Old Two" });
    expect(slugsOf(await selectStale(db))).toEqual(expect.arrayContaining([a.slug, b.slug]));
    const m = stub((c) => ({ headline: `Batch Draft Headline ${["Alpha", "Bravo", "Charlie"][c] ?? "Later"}`, lede: "A lede.", body: "B", pullQuote: null, tags: [] }));
    await runRegenerate(db, { selector: { kind: "stale-cause" }, slug: null, limit: null, write: false }, deps(m.client));
    expect(m.prompts.length).toBeGreaterThanOrEqual(2);
    // a dry-run writes nothing, so recentProse alone would never show the first draft
    expect(m.prompts[0]).not.toContain("Batch Draft Headline Alpha");
    for (const p of m.prompts.slice(1)) expect(p).toContain("Batch Draft Headline Alpha");
  });

  it("the prose uses the article's frozen gamertag after a rename", async () => {
    const oldName = `rg-old-${uid()}`;
    const newName = `rg-new-${uid()}`;
    const [p] = await db.insert(players).values({ gamertag: newName }).returning();
    pids.push(p!.id);
    await db.insert(playerGamertags).values([
      { playerId: p!.id, gamertag: oldName, firstSeenAt: hrs(0), lastSeenAt: hrs(1) },
      { playerId: p!.id, gamertag: newName, firstSeenAt: hrs(2), lastSeenAt: hrs(9) },
    ]);
    const s = await seed({ playerId: p!.id, articleTag: oldName });
    const m = stub();
    await runRegenerate(db, { selector: { kind: "slug" }, slug: s.slug, limit: null, write: true }, deps(m.client));
    expect(m.prompts[0]).toContain(oldName);
    expect(m.prompts[0]).not.toContain(newName);
    const after = await article(s.slug);
    expect(after.gamertag).toBe(oldName);
    expect((after.facts as { gamertag: string }).gamertag).toBe(oldName);
    expect(await db.select().from(articles).where(eq(articles.gamertag, newName))).toHaveLength(0); // no second row
  });

  it("--slug over an article whose cause does not change records 'regenerated' and shows no correction line", async () => {
    const s = await seed({
      verdict: { cause: "pvp", confidence: "definitive", attrBasis: "kill_line", rule: "A04" }, deathCause: "pvp",
      facts: { causeCategory: "pvp", cause: "pvp" }, tags: ["Obituaries", "Chernarus", "PvP"],
    });
    await runRegenerate(db, { selector: { kind: "slug" }, slug: s.slug, limit: null, write: true }, deps(stub().client));
    expect((await revisions(s.articleId)).map((r) => r.reason)).toEqual(["regenerated"]);
    expect((await getObituaryBySlug(db, s.slug))!.correctedAt).toBeNull();
  });

  it("a second --slug rewrite of a corrected article records 'regenerated' and keeps the first correction's line", async () => {
    const s = await seed({});
    await runRegenerate(db, { selector: { kind: "slug" }, slug: s.slug, limit: null, write: true }, deps(stub().client));
    await runRegenerate(db, { selector: { kind: "slug" }, slug: s.slug, limit: null, write: true },
      { ...deps(stub().client), now: () => hrs(550) });
    expect((await revisions(s.articleId)).map((r) => r.reason)).toEqual(["cause-corrected", "regenerated"]);
    expect((await getObituaryBySlug(db, s.slug))!.correctedAt).toEqual(hrs(500));
  });

  it("a rewrite whose article changed after it was selected writes and archives nothing", async () => {
    const s = await seed({});
    const [c] = await selectStale(db, { slug: s.slug });
    expect(c).toBeTruthy();
    // another run rewrites the article in between
    await runRegenerate(db, { selector: { kind: "slug" }, slug: s.slug, limit: null, write: true }, deps(stub().client));
    const between = await article(s.slug);
    const late = stub((n) => ({ headline: `A Late Draft Number ${n}`, lede: "Late.", body: "B", pullQuote: null, tags: [] }));
    const o = await regenerateOne(db, { ...deps(late.client), now: () => hrs(520) }, c!, { write: true, recent: [], batchProse: [] });
    expect(o).toMatchObject({ status: "failed" });
    expect((o as { why: string }).why).toMatch(/changed since it was selected/);
    expect(await article(s.slug)).toEqual(between);
    expect((await revisions(s.articleId)).map((r) => r.reason)).toEqual(["cause-corrected"]);
    // a retraction is guarded the same way
    await db.update(articles).set({ status: "retracted" }).where(eq(articles.id, s.articleId));
    const r = await regenerateOne(db, deps(null), { ...c!, action: "retract", reason: "retracted" }, { write: true, recent: [], batchProse: [] });
    expect(r).toMatchObject({ status: "failed" });
    expect(await revisions(s.articleId)).toHaveLength(1);
    await db.update(articles).set({ status: "published" }).where(eq(articles.id, s.articleId));
  });

  it("says so when every article of a --limit batch failed, since the next run picks the same ones", async () => {
    const boom: CompletionClient = { complete: async () => { throw new Error("api boom"); } };
    const out: string[] = [];
    const r = await runRegenerate(db, { selector: { kind: "stale-cause" }, slug: null, limit: 1, write: true }, deps(boom, out));
    expect(r).toMatchObject({ selected: 1, failed: 1 });
    expect(out.join("\n")).toMatch(/the next run with --limit selects the same/);
  });

  it("an unresolvable life is skipped and reported", async () => {
    const s = await seed({ articleTag: `rg-nobody-${uid()}` });
    const out: string[] = [];
    const r = await runRegenerate(db, { selector: { kind: "slug" }, slug: s.slug, limit: null, write: true }, deps(stub().client, out));
    expect(r.skipped).toBe(1);
    expect(out.join("\n")).toContain("SKIPPED: its life cannot be resolved");
    expect((await article(s.slug)).headline).toBe("The Old Headline");
  });
});

describe("regenerate --stale-inferred", () => {
  it("selects a v3 article of an inferred death, and its tag becomes the family tag after the rewrite", async () => {
    const s = await seed({ verdict: { cause: "starvation", confidence: "inferred", mechanismStated: false, rule: "B20" } });
    const v4 = await seed({ promptVersion: "obituary-v4", verdict: { cause: "starvation", confidence: "inferred", mechanismStated: false, rule: "B20" } });
    const picked = slugsOf(await selectStaleInferred(db));
    expect(picked).toContain(s.slug);
    expect(picked).not.toContain(v4.slug);
    expect((await getObituaryBySlug(db, s.slug))!.tags[2]).toBe("Unknown");
    const m = stub();
    await runRegenerate(db, { selector: { kind: "stale-inferred" }, slug: s.slug, limit: null, write: true }, deps(m.client));
    expect(m.prompts[0]).toContain("most likely starved");
    expect((await getObituaryBySlug(db, s.slug))!.tags[2]).toBe("Hunger and Thirst");
  });
});

describe("regenerate --inferred-family", () => {
  const hunger = { cause: "starvation", confidence: "inferred", mechanismStated: false, rule: "B20" } as const;
  const v4Facts = { death: { key: "starvation", tag: "Hunger and Thirst", certainty: "inferred", label: "Likely starvation" }, causeCategory: "Hunger and Thirst" };

  it("selects v4 articles of that family only, whatever the switch says", async () => {
    const s = await seed({ promptVersion: "obituary-v4", verdict: hunger, facts: v4Facts, tags: ["Obituaries", "Chernarus", "Hunger and Thirst"] });
    const v3 = await seed({ verdict: hunger });
    const other = await seed({ promptVersion: "obituary-v4", verdict: { cause: "cold_exposure", confidence: "inferred", mechanismStated: false, rule: "B20b" } });
    const picked = slugsOf(await selectInferredFamily(db, "hunger_thirst"));
    expect(picked).toContain(s.slug);
    expect(picked).not.toContain(v3.slug);
    expect(picked).not.toContain(other.slug);
  });

  it("never selects a v4 article that was written as not recorded", async () => {
    const s = await seed({
      promptVersion: "obituary-v4", verdict: hunger,
      facts: { death: { key: "unknown", tag: "Unknown", certainty: "unknown", label: "Not recorded" } },
    });
    expect(slugsOf(await selectInferredFamily(db, "hunger_thirst"))).not.toContain(s.slug);
  });

  it("is idempotent: a rewritten article is not selected again, so repeated --limit batches reach every article", async () => {
    const a = await seed({ startH: 800, promptVersion: "obituary-v4", verdict: hunger, facts: v4Facts, tags: ["Obituaries", "Chernarus", "Hunger and Thirst"] });
    const b = await seed({ startH: 810, promptVersion: "obituary-v4", verdict: hunger, facts: v4Facts, tags: ["Obituaries", "Chernarus", "Hunger and Thirst"] });
    const sel = { kind: "inferred-family", family: "hunger_thirst" } as const;
    const total = (await selectInferredFamily(db, "hunger_thirst")).length;
    expect(total).toBeGreaterThanOrEqual(2);
    const m = stub((c) => ({ headline: `The Record Stops At Number ${c}`, lede: "Nothing was written next to his name.", body: "B", pullQuote: null, tags: [] }));
    for (let i = 0; i < total; i++) {
      const r = await runRegenerate(db, { selector: sel, slug: null, limit: 1, write: true }, deps(m.client));
      expect(r.selected).toBe(1);
    }
    expect(await selectInferredFamily(db, "hunger_thirst")).toEqual([]);
    expect(await revisions(a.articleId)).toHaveLength(1);
    expect(await revisions(b.articleId)).toHaveLength(1);
    const again = await runRegenerate(db, { selector: sel, slug: null, limit: 1, write: true }, deps(m.client));
    expect(again.selected).toBe(0);
  });

  it("rewrites the article of a death held for review as not recorded too", async () => {
    const s = await seed({ startH: 820, promptVersion: "obituary-v4", verdict: { ...hunger, needsReview: true }, facts: v4Facts, tags: ["Obituaries", "Chernarus", "Hunger and Thirst"] });
    const m = stub(() => ({ headline: "The Record Simply Stops", lede: "Nothing was written next to his name.", body: "B", pullQuote: null, tags: [] }));
    const r = await runRegenerate(db, { selector: { kind: "inferred-family", family: "hunger_thirst" }, slug: s.slug, limit: null, write: true }, deps(m.client));
    expect(r).toMatchObject({ selected: 1, rewritten: 1, skipped: 0 });
    const after = await article(s.slug);
    expect(after.headline).toBe("The Record Simply Stops");
    expect((after.facts as { death: { key: string } }).death.key).toBe("unknown");
    // the stored verdict is left as it was: still held for review
    const [held] = await db.select().from(deathVerdicts).where(eq(deathVerdicts.lifeId, s.lifeId));
    expect(held!.needsReview).toBe(true);
  });

  it("rewrites a v4 article under the no-mechanism directive, with no family word left in it", async () => {
    const s = await seed({ promptVersion: "obituary-v4", verdict: hunger, facts: v4Facts, tags: ["Obituaries", "Chernarus", "Hunger and Thirst"] });
    const m = stub((c) => c === 0
      ? { headline: "He Starved In The Cold Months", lede: "L", body: "B", pullQuote: null, tags: [] } // rule 2: rejected
      : { headline: "The Record Simply Stops", lede: "Nothing was written next to his name.", body: "B", pullQuote: null, tags: [] });
    const out: string[] = [];
    const r = await runRegenerate(db, { selector: { kind: "inferred-family", family: "hunger_thirst" }, slug: s.slug, limit: null, write: true }, deps(m.client, out));
    expect(r.rewritten).toBe(1);
    expect(m.prompts[0]).toContain(NO_MECHANISM_DIRECTIVE);
    expect(m.prompts[0]).not.toContain("most likely starved");
    expect(m.prompts[0]).not.toContain("NOT CONFIRMED");
    const after = await article(s.slug);
    expect(after.headline).toBe("The Record Simply Stops");
    expect(after.tags![2]).toBe("Unknown");
    expect((after.facts as { death: { key: string } }).death.key).toBe("unknown");
    expect(`${after.headline} ${after.lede} ${after.body} ${after.tags!.join(" ")}`).not.toMatch(/starv|hunger|thirst/i);
    // the URL and the publish date, so the social posts can be deleted by hand
    expect(out.join("\n")).toContain(`url: https://example.test/obituaries/${s.slug}`);
  });
});

describe("regenerate --denied-credit", () => {
  const placerName = () => `rg-placer-${uid()}`;

  it("selects a victim's article that named a since-denied placer; the new prose does not contain the name", async () => {
    const name = placerName();
    const [pl] = await db.insert(players).values({ gamertag: name }).returning();
    pids.push(pl!.id);
    const s = await seed({ facts: { creditSent: true, trapKills: 0, priors: { trapKills: 0 }, death: { key: "tripwire", tag: "Trap", certainty: "definitive" } }, promptVersion: "obituary-v4" });
    // The credit as it stood when the article was written: the writer was handed the placer's name.
    const [credit] = await db.insert(kills).values({ serverId, killerGamertag: name, killerPlayerId: pl!.id, victimGamertag: "y", victimLifeId: s.lifeId,
      weapon: "Tripwire", occurredAt: hrs(2), basis: "trap_placement", creditSource: "classifier" }).returning();
    const first = stub();
    await runRegenerate(db, { selector: { kind: "slug" }, slug: s.slug, limit: null, write: false }, deps(first.client));
    expect(first.prompts[0]).toContain(name);
    expect(slugsOf(await selectDeniedCredit(db))).not.toContain(s.slug);
    // The operator denies it.
    await db.delete(kills).where(eq(kills.id, credit!.id));
    const m = stub();
    expect(slugsOf(await selectDeniedCredit(db))).toContain(s.slug);
    await runRegenerate(db, { selector: { kind: "denied-credit" }, slug: s.slug, limit: null, write: true }, deps(m.client));
    expect(m.prompts[0]).not.toContain(name);
    const after = await article(s.slug);
    expect(`${after.headline} ${after.lede} ${after.body}`).not.toContain(name);
    expect((after.facts as { creditSent: boolean }).creditSent).toBe(false);
    expect((await revisions(s.articleId))[0]!.reason).toBe("cause-corrected");
  });

  it("an article whose credit still stands is not selected", async () => {
    const [pl] = await db.insert(players).values({ gamertag: placerName() }).returning();
    pids.push(pl!.id);
    const s = await seed({ facts: { creditSent: true, trapKills: 0, priors: { trapKills: 0 } }, promptVersion: "obituary-v4" });
    await db.insert(kills).values({ serverId, killerGamertag: "x", killerPlayerId: pl!.id, victimGamertag: "y", victimLifeId: s.lifeId,
      weapon: "Tripwire", occurredAt: hrs(2), basis: "trap_placement", creditSource: "classifier" });
    expect(slugsOf(await selectDeniedCredit(db))).not.toContain(s.slug);
  });

  it("a placer's article whose trapKills exceeds the live count is rewritten, and its kill column follows", async () => {
    const s = await seed({ startH: 100, facts: { creditSent: false, trapKills: 1, kills: 1, priors: { trapKills: 0 } }, promptVersion: "obituary-v4" });
    await db.update(articles).set({ kills: 1 }).where(eq(articles.slug, s.slug));
    const picked = await selectDeniedCredit(db);
    const c = picked.find((x) => x.article.slug === s.slug)!;
    expect(c).toMatchObject({ action: "rewrite", reason: "kills-corrected" });
    await runRegenerate(db, { selector: { kind: "denied-credit" }, slug: s.slug, limit: null, write: true }, deps(stub().client));
    const after = await article(s.slug);
    expect(after.kills).toBe(0);
    expect((after.facts as { trapKills: number }).trapKills).toBe(0);
    // a count correction is not a cause correction: no line on the page
    expect((await getObituaryBySlug(db, s.slug))!.correctedAt).toBeNull();
    // and a corrected article is not selected again
    expect(slugsOf(await selectDeniedCredit(db))).not.toContain(s.slug);
  });

  it("an article whose life cannot be resolved is listed and reported, not dropped", async () => {
    const s = await seed({ startH: 250, articleTag: `rg-nobody-${uid()}`, facts: { creditSent: false, trapKills: 1, priors: { trapKills: 0 } }, promptVersion: "obituary-v4" });
    expect(slugsOf(await selectDeniedCredit(db))).toContain(s.slug);
    const out: string[] = [];
    const r = await runRegenerate(db, { selector: { kind: "denied-credit" }, slug: s.slug, limit: null, write: true }, deps(stub().client, out));
    expect(r.skipped).toBe(1);
    expect(out.join("\n")).toContain("SKIPPED: its life cannot be resolved");
  });

  it("a later life's article whose priors.trapKills held the denied kill is selected", async () => {
    const s = await seed({ startH: 200, facts: { creditSent: false, trapKills: 0, priors: { trapKills: 1 } }, promptVersion: "obituary-v4" });
    expect(slugsOf(await selectDeniedCredit(db))).toContain(s.slug);
  });

  it("a placer's article whose life no longer qualifies is retracted, its URL printed, and --restore puts it back", async () => {
    const s = await seed({ startH: 300, playtime: 100, facts: { creditSent: false, trapKills: 1, priors: { trapKills: 0 } }, promptVersion: "obituary-v4" });
    const m = stub();
    const out: string[] = [];
    const dry = await runRegenerate(db, { selector: { kind: "denied-credit" }, slug: s.slug, limit: null, write: false }, deps(m.client, out));
    expect(dry.retracted).toBe(0);
    expect((await article(s.slug)).status).toBe("published");
    const r = await runRegenerate(db, { selector: { kind: "denied-credit" }, slug: s.slug, limit: null, write: true }, deps(m.client, out));
    expect(r.retracted).toBe(1);
    expect(m.prompts).toHaveLength(0); // a retraction calls no model
    expect(out.join("\n")).toContain(`url: https://example.test/obituaries/${s.slug}`);
    const after = await article(s.slug);
    expect(after.status).toBe("retracted");
    expect(after.slug).toBe(s.slug);
    expect((await revisions(s.articleId)).map((x) => x.reason)).toEqual(["retracted"]);
    expect(await restore(db, s.slug, { now: () => hrs(600), out: () => {}, siteUrl: "https://example.test" })).toBe(true);
    expect((await article(s.slug)).status).toBe("published");
  });

  it("refuses while the verdict queue is not empty", async () => {
    const s = await seed({ startH: 400, facts: { creditSent: false, trapKills: 1, priors: { trapKills: 0 } }, promptVersion: "obituary-v4" });
    await db.insert(deathVerdictQueue).values({ lifeId: s.lifeId });
    try {
      const { sweepBacklog: _real, ...withRealCheck } = deps(stub().client);
      await expect(runRegenerate(db, { selector: { kind: "denied-credit" }, slug: null, limit: null, write: true }, withRealCheck))
        .rejects.toBeInstanceOf(SweepNotCaughtUpError);
      // and on a stub that reports a fold still behind
      await expect(runRegenerate(db, { selector: { kind: "denied-credit" }, slug: null, limit: null, write: true },
        { ...deps(stub().client), sweepBacklog: async () => ({ queued: 0, unswept: 0, foldBehind: true }) }))
        .rejects.toThrow(/has not caught up/);
      expect((await article(s.slug)).status).toBe("published");
      expect(await revisions(s.articleId)).toHaveLength(0);
    } finally {
      await db.delete(deathVerdictQueue).where(eq(deathVerdictQueue.lifeId, s.lifeId));
    }
  });
});

describe("a retracted obituary", () => {
  it("blocks its life in findObituaryTargets, and the crier and every article reader skip it", async () => {
    const s = await seed({ startH: 700, verdict: { cause: "pvp", confidence: "definitive", attrBasis: "kill_line", rule: "A04" }, deathCause: "pvp" });
    const has = async () => (await findObituaryTargets(db, { limit: 1000, maxAttempts: 3, since: hrs(-1) })).some((t) => t.lifeId === s.lifeId);
    await db.update(articles).set({ status: "failed", attempts: 1 }).where(eq(articles.slug, s.slug));
    expect(await has()).toBe(true); // a failed stub with attempts left does not block
    await db.update(articles).set({ status: "retracted" }).where(eq(articles.slug, s.slug));
    expect(await has()).toBe(false);
    expect(await getObituaryBySlug(db, s.slug)).toBeNull();
    const feed = await getPublishedObituaries(db, { page: 1, pageSize: 500 });
    expect(feed.rows.map((r) => r.slug)).not.toContain(s.slug);
    const targets = await findSyndicationTargets(db, { channels: ["discord"], since: hrs(-1), maxAttempts: 3, limit: 500 });
    expect(targets.map((t) => t.slug)).not.toContain(s.slug);
  });
});

describe("regenerate --restore", () => {
  it("puts the old text back and archives the new; the correction line follows the text on the page", async () => {
    const s = await seed({});
    await runRegenerate(db, { selector: { kind: "slug" }, slug: s.slug, limit: null, write: true }, deps(stub().client));
    expect((await getObituaryBySlug(db, s.slug))!.correctedAt).not.toBeNull();
    const out: string[] = [];
    expect(await restore(db, s.slug, { now: () => hrs(600), out: (l) => out.push(l), siteUrl: "https://example.test" })).toBe(true);
    let a = await article(s.slug);
    expect(a.headline).toBe("The Old Headline");
    expect(a.promptVersion).toBe("obituary-v3");
    expect(a.slug).toBe(s.slug);
    let revs = await revisions(s.articleId);
    expect(revs.map((r) => r.reason)).toEqual(["cause-corrected", "restored"]);
    expect(revs[1]!.snapshot).toMatchObject({ headline: "A Quiet Ending Number One" });
    // the original text is back: no "rewritten" line over it
    expect((await getObituaryBySlug(db, s.slug))!.correctedAt).toBeNull();
    expect(out.join("\n")).toContain("restored the version archived");
    // restoring again puts the rewrite back, with its line
    await restore(db, s.slug, { now: () => hrs(700), out: () => {}, siteUrl: "https://example.test" });
    a = await article(s.slug);
    expect(a.headline).toBe("A Quiet Ending Number One");
    expect((await getObituaryBySlug(db, s.slug))!.correctedAt).toEqual(hrs(500));
    revs = await revisions(s.articleId);
    expect(revs).toHaveLength(3);
  });

  it("an article with nothing archived, or no article, is reported and changes nothing", async () => {
    const s = await seed({});
    const out: string[] = [];
    expect(await restore(db, s.slug, { now: () => hrs(600), out: (l) => out.push(l), siteUrl: "https://example.test" })).toBe(false);
    expect(await restore(db, "rg-no-such-slug", { now: () => hrs(600), out: (l) => out.push(l), siteUrl: "https://example.test" })).toBe(false);
    expect(out.join("\n")).toMatch(/nothing to restore[\s\S]*no obituary with this slug/);
  });
});
