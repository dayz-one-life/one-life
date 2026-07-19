import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { user, notifications } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { generateTick } from "../src/generate.js";
import type { Generator } from "../src/types.js";

const { db, sql } = getTestDb();
const log = { info: () => {}, warn: () => {} };
const NOW = new Date("2026-07-19T12:00:00Z");
const SINCE = new Date("2026-07-01T00:00:00Z");

beforeAll(async () => {
  await db.insert(user).values({ id: "nu1", name: "NU1", email: "nu1@x.com" });
});
beforeEach(async () => { await db.delete(notifications); });
afterAll(async () => { await sql.end(); });

const oneDraft: Generator = async () => [{
  userId: "nu1", kind: "test_kind", naturalKey: "test:1",
  title: "T", body: "B", href: "/x",
}];

const base = { now: NOW, since: SINCE, lookbackHours: 24, siteUrl: "https://s", log };

describe("generateTick", () => {
  it("writes nothing when since is null (generation off)", async () => {
    const r = await generateTick(db, { ...base, since: null, dryRun: false, generators: [oneDraft] });
    expect(r).toEqual({ drafts: 0, inserted: 0, disabled: true });
    expect(await db.select().from(notifications)).toHaveLength(0);
  });

  it("writes nothing in dry run", async () => {
    const r = await generateTick(db, { ...base, dryRun: true, generators: [oneDraft] });
    expect(r.drafts).toBe(1);
    expect(r.inserted).toBe(0);
    expect(await db.select().from(notifications)).toHaveLength(0);
  });

  it("inserts drafts when live", async () => {
    const r = await generateTick(db, { ...base, dryRun: false, generators: [oneDraft] });
    expect(r.inserted).toBe(1);
    expect(await db.select().from(notifications)).toHaveLength(1);
  });

  it("is idempotent — running twice inserts one row", async () => {
    await generateTick(db, { ...base, dryRun: false, generators: [oneDraft] });
    const second = await generateTick(db, { ...base, dryRun: false, generators: [oneDraft] });
    expect(second.inserted).toBe(0);
    expect(await db.select().from(notifications)).toHaveLength(1);
  });

  it("dedups duplicate natural keys within a single batch", async () => {
    const r = await generateTick(db, { ...base, dryRun: false, generators: [oneDraft, oneDraft] });
    expect(r.inserted).toBe(1);
    expect(await db.select().from(notifications)).toHaveLength(1);
  });

  it("one failing generator does not stop the others", async () => {
    const boom: Generator = async () => { throw new Error("boom"); };
    const r = await generateTick(db, { ...base, dryRun: false, generators: [boom, oneDraft] });
    expect(r.inserted).toBe(1);
  });
});
