import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { articles, servers } from "@onelife/db";
import { inArray } from "drizzle-orm";
import { getTestDb } from "@onelife/test-support";
import { parseCutoverArgs, runCutover } from "../src/fleet-cutover.js";

const { db, sql } = getTestDb();
const base = Math.floor(Math.random() * 1e7) + 14e8;
const A = base, B = base + 1, C = base + 2;
const AT = new Date("2026-10-15T09:00:00Z");

const ids = async () => (await db.select({ id: servers.id }).from(servers).where(inArray(servers.nitradoServiceId, [A, B, C]))).map((r) => r.id);
async function clear() {
  const s = await ids();
  if (s.length) await db.delete(articles).where(inArray(articles.serverId, s));
  await db.delete(servers).where(inArray(servers.nitradoServiceId, [A, B, C]));
}
async function reset() {
  await clear();
  await db.delete(servers).where(inArray(servers.nitradoServiceId, [A, B, C]));
  await db.insert(servers).values([
    { nitradoServiceId: A, name: "Chernarus", map: "chernarusplus", slug: "fc-chern" },
    { nitradoServiceId: B, name: "Livonia", map: "enoch", slug: "fc-liv" },
  ]);
}
const rows = () => db.select().from(servers).where(inArray(servers.nitradoServiceId, [A, B, C]));
beforeEach(reset);
afterAll(async () => { await clear(); await sql.end(); });

describe("fleet-cutover", () => {
  const argv = ["--retire", "fc-chern=fc-chern-1.29", "--retire", "fc-liv",
    "--add", `fc-chern:Chernarus:chernarusplus:${B}`, "--add", `fc-nas:Nasdara:nasdara:${C}`];

  it("parses args; dry run by default", () => {
    const plan = parseCutoverArgs(argv);
    expect(plan.apply).toBe(false);
    expect(plan.retire).toEqual([{ slug: "fc-chern", newSlug: "fc-chern-1.29" }, { slug: "fc-liv", newSlug: null }]);
    expect(plan.add[0]).toEqual({ slug: "fc-chern", name: "Chernarus", map: "chernarusplus", serviceId: B });
  });

  it("--retired-at requires an explicit offset", () => {
    for (const ok of ["2026-10-09T18:07:00Z", "2026-10-09T18:07:00+00:00"]) {
      expect(parseCutoverArgs(["--retired-at", ok]).retiredAt!.toISOString()).toBe("2026-10-09T18:07:00.000Z");
    }
    for (const bad of ["2026-10-09T18:07:00", "2026-10-09 18:07", "2026-10-09", "10/09/2026"]) {
      expect(() => parseCutoverArgs(["--retired-at", bad])).toThrow(/fleet-cutover: bad --retired-at/);
    }
  });

  it("dry run changes nothing but reports the after-state", async () => {
    const r = await runCutover(db, parseCutoverArgs(argv), AT);
    expect(r.after.find((s) => s.slug === "fc-nas")).toBeTruthy();
    expect((await rows()).map((s) => s.slug).sort()).toEqual(["fc-chern", "fc-liv"]);
  });

  it("--apply retires, hands the slug over, and adds rows with ingest_from", async () => {
    await runCutover(db, parseCutoverArgs([...argv, "--apply"]), AT);
    const all = await rows();
    const old = all.find((s) => s.slug === "fc-chern-1.29")!;
    expect(old).toMatchObject({ active: false, nitradoServiceId: A });
    expect(old.retiredAt!.toISOString()).toBe(AT.toISOString());
    const nu = all.find((s) => s.slug === "fc-chern")!;
    expect(nu).toMatchObject({ active: true, nitradoServiceId: B, map: "chernarusplus" });
    expect(nu.ingestFrom!.toISOString()).toBe(AT.toISOString());
    expect(all.find((s) => s.slug === "fc-liv")).toMatchObject({ active: false });
  });

  it("refuses atomically when a later op is invalid", async () => {
    // The third op collides: fc-liv's slug is still held by its (now retired) row.
    const collide = [...argv, "--add", "fc-liv:X:enoch:" + C, "--apply"];
    await expect(runCutover(db, parseCutoverArgs(collide), AT)).rejects.toThrow(/slug/);
    expect((await rows()).map((s) => [s.slug, s.active])).toEqual(expect.arrayContaining([["fc-chern", true], ["fc-liv", true]]));
  });

  it("refuses an unknown slug and an already-retired target", async () => {
    await expect(runCutover(db, parseCutoverArgs(["--retire", "nope", "--apply"]), AT)).rejects.toThrow(/no server/);
    await runCutover(db, parseCutoverArgs(["--retire", "fc-liv", "--apply"]), AT);
    await expect(runCutover(db, parseCutoverArgs(["--retire", "fc-liv", "--apply"]), AT)).rejects.toThrow(/already retired/);
  });

  it("accepts a paused row and honours --retired-at", async () => {
    await db.update(servers).set({ active: false }).where(inArray(servers.nitradoServiceId, [B]));
    await runCutover(db, parseCutoverArgs(["--retire", "fc-liv", "--retired-at", "2026-10-09T18:07:00Z", "--apply"]), AT);
    const liv = (await rows()).find((s) => s.slug === "fc-liv")!;
    expect(liv.retiredAt!.toISOString()).toBe("2026-10-09T18:07:00.000Z");
  });

  it("refuses a second active row on one service", async () => {
    await expect(runCutover(db, parseCutoverArgs(["--add", `fc-nas:N:nasdara:${A}`, "--apply"]), AT)).rejects.toThrow(/active/);
  });

  describe("obituaries on a renamed server", () => {
    async function seedArticles() {
      const all = await rows();
      const chern = all.find((s) => s.slug === "fc-chern")!, liv = all.find((s) => s.slug === "fc-liv")!;
      await db.insert(articles).values([
        { kind: "obituary", slug: `fc-obit-chern-${base}`, serverId: chern.id, map: "chernarusplus", mapSlug: "fc-chern", gamertag: "Ghost", lifeNumber: 3 },
        { kind: "obituary", slug: `fc-obit-liv-${base}`, serverId: liv.id, map: "enoch", mapSlug: "fc-liv", gamertag: "Ghost", lifeNumber: 1 },
      ]);
      return { chern, liv };
    }
    const slugOf = async (slug: string) => (await db.select().from(articles).where(inArray(articles.slug, [slug])))[0]!.mapSlug;

    it("--apply re-points the renamed server's articles and leaves other servers' alone", async () => {
      await seedArticles();
      const r = await runCutover(db, parseCutoverArgs([...argv, "--apply"]), AT);
      expect(r.repointedArticles).toBe(1);
      expect(await slugOf(`fc-obit-chern-${base}`)).toBe("fc-chern-1.29");
      expect(await slugOf(`fc-obit-liv-${base}`)).toBe("fc-liv");
    });

    it("a dry run reports the count but changes no article", async () => {
      await seedArticles();
      const r = await runCutover(db, parseCutoverArgs(argv), AT);
      expect(r.repointedArticles).toBe(1);
      expect(await slugOf(`fc-obit-chern-${base}`)).toBe("fc-chern");
    });
  });
});
