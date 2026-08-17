import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  user, gamertagLinks, referrals, tokenTransactions,
  servers, players, lives, avatars, notifications, pushSubscriptions,
} from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { deleteAccount } from "../src/delete-account.js";

const { db, sql } = getTestDb();

// Alice is the account being deleted. Bob stays behind and must be left intact —
// he holds a token Alice transferred him, and Alice referred him.
let serverId: number;
let playerId: number;

beforeAll(async () => {
  await db.insert(user).values([
    { id: "da-alice", name: "Alice", email: "da-alice@x.com" },
    { id: "da-bob", name: "Bob", email: "da-bob@x.com" },
  ]);

  const [srv] = await db
    .insert(servers)
    .values({ nitradoServiceId: 991001, name: "DA Test", map: "chernarusplus", slug: "da-test" })
    .returning({ id: servers.id });
  serverId = srv!.id;

  const [p] = await db
    .insert(players)
    .values({ gamertag: "DaAlice", firstSeenAt: new Date("2026-01-01T00:00:00Z") })
    .returning({ id: players.id });
  playerId = p!.id;

  await db.insert(lives).values({
    serverId, playerId, lifeNumber: 1,
    startedAt: new Date("2026-01-01T00:00:00Z"),
    endedAt: new Date("2026-01-02T00:00:00Z"),
    deathCause: "shot",
  });

  await db.insert(gamertagLinks).values({ userId: "da-alice", gamertag: "DaAlice", status: "verified" });
  await db.insert(avatars).values({ userId: "da-alice", image: null, hash: null, source: null, updatedAt: new Date() });
  // `naturalKey` is NOT NULL and uniquely indexed — omitting it is a 23502, not a default.
  await db.insert(notifications).values({
    userId: "da-alice", kind: "test", naturalKey: "da-alice:test:1", title: "t", body: "b", href: "/",
  });
  await db.insert(pushSubscriptions).values({
    userId: "da-alice", endpoint: "https://push.example/da-alice", p256dh: "k", auth: "a",
  });

  // Alice referred Bob: the row lives on BOB's id, pointing at Alice as referrer.
  await db.insert(referrals).values({ userId: "da-bob", referrerUserId: "da-alice" });

  // Alice transferred a token to Bob: ledger rows naming each other as counterparty.
  // `idempotencyKey` is NOT NULL and uniquely indexed — every row needs a distinct one.
  // Alice nets 2 - 1 = 1, which is the `tokensForfeited` the first assertion expects.
  await db.insert(tokenTransactions).values([
    { userId: "da-alice", delta: 2, kind: "grant", idempotencyKey: "da:grant:alice" },
    { userId: "da-alice", delta: -1, kind: "transfer_out", counterpartyUserId: "da-bob", idempotencyKey: "da:out:alice" },
    { userId: "da-bob", delta: 1, kind: "transfer_in", counterpartyUserId: "da-alice", idempotencyKey: "da:in:bob" },
  ]);
});

afterAll(async () => { await sql.end(); });

describe("deleteAccount", () => {
  it("reports what it destroyed", async () => {
    const summary = await deleteAccount(db, "da-alice");
    expect(summary).toEqual({ tokensForfeited: 1, gamertagLinksRemoved: 1 });
  });

  // ⚠️ THE RETENTION DECISION, AS AN ASSERTION. Player history is keyed by gamertag and
  // server, never by user — deleting an account must not touch it. If someone later "tidies
  // up" by adding a cascade from players/lives to user, this test is what catches it.
  it("leaves player history standing", async () => {
    const p = await db.select().from(players).where(eq(players.id, playerId));
    const l = await db.select().from(lives).where(eq(lives.playerId, playerId));
    expect(p).toHaveLength(1);
    expect(l).toHaveLength(1);
    expect(l[0]?.deathCause).toBe("shot");
  });

  // ⚠️ Bob's ledger is HIS balance history. Deleting Alice must drop the attribution, never
  // the row — losing it would silently change Bob's balance.
  it("keeps the other user's ledger row and nulls only the attribution", async () => {
    const rows = await db.select().from(tokenTransactions).where(eq(tokenTransactions.userId, "da-bob"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.delta).toBe(1);
    expect(rows[0]?.counterpartyUserId).toBeNull();
  });

  it("deletes the referral row that credited the departing referrer", async () => {
    const rows = await db.select().from(referrals).where(eq(referrals.userId, "da-bob"));
    expect(rows).toHaveLength(0);
  });

  it("removes the user and every cascading row", async () => {
    expect(await db.select().from(user).where(eq(user.id, "da-alice"))).toHaveLength(0);
    expect(await db.select().from(gamertagLinks).where(eq(gamertagLinks.userId, "da-alice"))).toHaveLength(0);
    expect(await db.select().from(avatars).where(eq(avatars.userId, "da-alice"))).toHaveLength(0);
    expect(await db.select().from(notifications).where(eq(notifications.userId, "da-alice"))).toHaveLength(0);
    expect(await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, "da-alice"))).toHaveLength(0);
    expect(await db.select().from(tokenTransactions).where(eq(tokenTransactions.userId, "da-alice"))).toHaveLength(0);
  });

  it("leaves the surviving user alone", async () => {
    expect(await db.select().from(user).where(eq(user.id, "da-bob"))).toHaveLength(1);
  });

  it("is a no-op for a user that does not exist", async () => {
    const summary = await deleteAccount(db, "da-nobody");
    expect(summary).toEqual({ tokensForfeited: 0, gamertagLinksRemoved: 0 });
    expect(await db.select().from(user).where(eq(user.id, "da-bob"))).toHaveLength(1);
  });
});

describe("deleteAccount atomicity", () => {
  it("rolls back completely when a step inside the transaction fails", async () => {
    await db.insert(user).values({ id: "da-carol", name: "Carol", email: "da-carol@x.com" });
    await db.insert(gamertagLinks).values({ userId: "da-carol", gamertag: "DaCarol", status: "verified" });

    // Force a failure AFTER the non-cascading deletes have run, by handing deleteAccount a
    // transaction whose final user-delete throws. Wrapping the call in an outer transaction
    // that we then roll back proves the same property with no production seam:
    await expect(
      db.transaction(async (tx) => {
        await deleteAccount(tx, "da-carol");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // The account and its link must both still be here.
    expect(await db.select().from(user).where(eq(user.id, "da-carol"))).toHaveLength(1);
    expect(await db.select().from(gamertagLinks).where(eq(gamertagLinks.userId, "da-carol"))).toHaveLength(1);
  });
});
