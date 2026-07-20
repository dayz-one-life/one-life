import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { user, notifications, pushSubscriptions } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { activeSubscriptionsFor, deleteSubscription, findUnpushed, markPushed, recordFailure } from "../src/push-store.js";

const { db, sql } = getTestDb();
const NOW = new Date("2026-07-19T12:00:00Z");

beforeAll(async () => {
  await db.insert(user).values({ id: "ps1", name: "PS1", email: "ps1@x.com" });
});
beforeEach(async () => {
  await db.delete(notifications);
  await db.delete(pushSubscriptions);
});
afterAll(async () => { await sql.end(); });

const note = (naturalKey: string, pushedAt: Date | null = null) => ({
  userId: "ps1", kind: "k", naturalKey, title: "t", body: "b", href: "/h", pushedAt,
});

describe("push store", () => {
  it("finds only unpushed notifications, oldest first", async () => {
    await db.insert(notifications).values([note("a"), note("b", NOW)]);
    const rows = await findUnpushed(db, { limit: 10 });
    expect(rows.map((r) => r.title)).toEqual(["t"]);
    expect(rows).toHaveLength(1);
  });

  it("markPushed stamps the row so it is not found again", async () => {
    const [n] = await db.insert(notifications).values(note("c")).returning();
    await markPushed(db, n!.id, NOW);
    expect(await findUnpushed(db, { limit: 10 })).toHaveLength(0);
  });

  it("returns only enabled subscriptions", async () => {
    await db.insert(pushSubscriptions).values([
      { userId: "ps1", endpoint: "e1", p256dh: "p", auth: "a" },
      { userId: "ps1", endpoint: "e2", p256dh: "p", auth: "a", disabledAt: NOW },
    ]);
    const subs = await activeSubscriptionsFor(db, "ps1");
    expect(subs.map((s) => s.endpoint)).toEqual(["e1"]);
  });

  it("recordFailure disables a subscription at the fifth failure", async () => {
    const [s] = await db.insert(pushSubscriptions).values({ userId: "ps1", endpoint: "e3", p256dh: "p", auth: "a" }).returning();
    for (let i = 0; i < 4; i++) await recordFailure(db, s!.id, NOW);
    // Still active at 4 failures — this is what proves the threshold is 5, not 1.
    expect(await activeSubscriptionsFor(db, "ps1")).toHaveLength(1);
    await recordFailure(db, s!.id, NOW);
    expect(await activeSubscriptionsFor(db, "ps1")).toHaveLength(0);
  });

  it("deleteSubscription removes the row", async () => {
    const [s] = await db.insert(pushSubscriptions).values({ userId: "ps1", endpoint: "e4", p256dh: "p", auth: "a" }).returning();
    await deleteSubscription(db, s!.id);
    expect(await activeSubscriptionsFor(db, "ps1")).toHaveLength(0);
  });
});
