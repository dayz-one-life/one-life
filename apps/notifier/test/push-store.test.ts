import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { user, notifications, pushSubscriptions, devicePushTokens } from "@onelife/db";
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
  await db.delete(devicePushTokens);
});
afterAll(async () => { await sql.end(); });

const note = (naturalKey: string, pushedAt: Date | null = null) => ({
  userId: "ps1", kind: "k", naturalKey, title: "t", body: "b", href: "/h", pushedAt,
});

const webSub = (id: number, endpoint: string) =>
  ({ kind: "webpush" as const, id, endpoint, p256dh: "p", auth: "a" });

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
    expect(subs.map((s) => (s.kind === "webpush" ? s.endpoint : s.token))).toEqual(["e1"]);
  });

  it("recordFailure disables a subscription at the fifth failure", async () => {
    const [s] = await db.insert(pushSubscriptions).values({ userId: "ps1", endpoint: "e3", p256dh: "p", auth: "a" }).returning();
    for (let i = 0; i < 4; i++) await recordFailure(db, webSub(s!.id, "e3"), NOW);
    // Still active at 4 failures — this is what proves the threshold is 5, not 1.
    expect(await activeSubscriptionsFor(db, "ps1")).toHaveLength(1);
    await recordFailure(db, webSub(s!.id, "e3"), NOW);
    expect(await activeSubscriptionsFor(db, "ps1")).toHaveLength(0);
  });

  it("deleteSubscription removes the row", async () => {
    const [s] = await db.insert(pushSubscriptions).values({ userId: "ps1", endpoint: "e4", p256dh: "p", auth: "a" }).returning();
    await deleteSubscription(db, webSub(s!.id, "e4"));
    expect(await activeSubscriptionsFor(db, "ps1")).toHaveLength(0);
  });

  it("returns both transports for a user and excludes disabled rows from each", async () => {
    await db.insert(pushSubscriptions).values([
      { userId: "ps1", endpoint: "w1", p256dh: "p", auth: "a" },
      { userId: "ps1", endpoint: "w2", p256dh: "p", auth: "a", disabledAt: NOW },
    ]);
    await db.insert(devicePushTokens).values([
      { userId: "ps1", token: "d1", platform: "ios", deviceId: "dev1" },
      { userId: "ps1", token: "d2", platform: "android", deviceId: "dev2", disabledAt: NOW },
    ]);
    const subs = await activeSubscriptionsFor(db, "ps1");
    expect(subs.map((s) => (s.kind === "webpush" ? s.endpoint : s.token)).sort()).toEqual(["d1", "w1"]);
  });

  // THE test this whole union exists for. The two tables have independent sequences, so ids
  // collide in production. Dispatching on a bare id retires the WRONG transport's row.
  it("retiring a device token leaves an identically-numbered browser subscription alone", async () => {
    const [web] = await db.insert(pushSubscriptions)
      .values({ userId: "ps1", endpoint: "w-collide", p256dh: "p", auth: "a" }).returning();
    // Force the device row onto the same id the browser row already has. `sql.unsafe` because
    // ALTER SEQUENCE takes no bind parameters; the interpolated value is an integer we just read
    // back from the database, not caller input.
    await sql.unsafe(`ALTER SEQUENCE device_push_tokens_id_seq RESTART WITH ${web!.id}`);
    const [dev] = await db.insert(devicePushTokens)
      .values({ userId: "ps1", token: "d-collide", platform: "ios", deviceId: "dev" }).returning();
    expect(dev!.id).toBe(web!.id);

    await deleteSubscription(db, { kind: "device", id: dev!.id, token: "d-collide", platform: "ios" });

    const left = await activeSubscriptionsFor(db, "ps1");
    expect(left.map((s) => s.kind)).toEqual(["webpush"]);
  });

  it("recordFailure disables a device token at the fifth failure", async () => {
    const [d] = await db.insert(devicePushTokens)
      .values({ userId: "ps1", token: "d-fail", platform: "android", deviceId: "dev" }).returning();
    const sub = { kind: "device" as const, id: d!.id, token: "d-fail", platform: "android" as const };
    for (let i = 0; i < 4; i++) await recordFailure(db, sub, NOW);
    // Still active at 4 — this is what proves the threshold is 5, not 1.
    expect(await activeSubscriptionsFor(db, "ps1")).toHaveLength(1);
    await recordFailure(db, sub, NOW);
    expect(await activeSubscriptionsFor(db, "ps1")).toHaveLength(0);
  });
});
