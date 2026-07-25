import { describe, it, expect, beforeEach, afterAll } from "vitest";
import type { Database } from "@onelife/db";
import { user, gamertagLinks, userPreferences, locationShares, servers } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { eq } from "drizzle-orm";
import { PgVerifierStore } from "../src/pg-store.js";

const { db, sql } = getTestDb();

let serverId = 0;

beforeEach(async () => {
  await sql`truncate table location_shares, user_preferences, gamertag_links, servers, "user" restart identity cascade`;
  await db.insert(user).values([
    { id: "vr", name: "VR", email: "vr@x.com" },
    { id: "other", name: "OT", email: "ot@x.com" },
  ]);
  const [srv] = await db.insert(servers)
    .values({ nitradoServiceId: 996001, name: "Sakhal", map: "sakhal", slug: "vr-sakhal" })
    .returning();
  serverId = srv!.id;
});
afterAll(async () => { await sql.end(); });

describe("verifyLink consent reset", () => {
  it("resets the presence master switch when a link is verified", async () => {
    const [link] = await db.insert(gamertagLinks)
      .values({ userId: "vr", gamertag: "ResetMe", status: "pending" })
      .returning();
    await db.insert(userPreferences).values({ userId: "vr", sharePresence: true });

    await db.transaction(async (tx) => {
      const store = new PgVerifierStore(tx as unknown as Database);
      await store.verifyLink(link!.id, new Date());
    });

    const [prefs] = await db.select().from(userPreferences).where(eq(userPreferences.userId, "vr"));
    expect(prefs!.sharePresence).toBe(false);
  });

  // ⚠️ Sub-project E: the `share_location` half of this reset became a DELETE when that column
  // was dropped for session-scoped grants. A re-verified link is a NEW claim on that identity
  // and must not inherit outbound sharing — the reason F2 reset the switch is the reason this
  // deletes the rows. Mutation-tested: removing the delete makes this fail.
  it("deletes every location grant the re-verifying user had made", async () => {
    const [link] = await db.insert(gamertagLinks)
      .values({ userId: "vr", gamertag: "ResetMe", status: "pending" })
      .returning();
    await db.insert(locationShares).values({
      granterUserId: "vr", granteeUserId: "other", serverId,
      granterSessionConnectedAt: new Date("2026-07-25T10:00:00Z"),
    });

    await db.transaction(async (tx) => {
      const store = new PgVerifierStore(tx as unknown as Database);
      await store.verifyLink(link!.id, new Date());
    });

    expect(await db.select().from(locationShares)).toHaveLength(0);
  });

  // One-directional: it clears what this user shares, never what others share WITH them.
  // Deleting inbound grants would let anyone revoke another player's sharing by re-verifying.
  it("leaves grants made TO the re-verifying user alone", async () => {
    const [link] = await db.insert(gamertagLinks)
      .values({ userId: "vr", gamertag: "ResetMe", status: "pending" })
      .returning();
    await db.insert(locationShares).values({
      granterUserId: "other", granteeUserId: "vr", serverId,
      granterSessionConnectedAt: new Date("2026-07-25T10:00:00Z"),
    });

    await db.transaction(async (tx) => {
      const store = new PgVerifierStore(tx as unknown as Database);
      await store.verifyLink(link!.id, new Date());
    });

    expect(await db.select().from(locationShares)).toHaveLength(1);
  });

  it("is a no-op for a first-time verifier with no preferences row", async () => {
    const [link] = await db.insert(gamertagLinks)
      .values({ userId: "vr", gamertag: "FirstTime", status: "pending" })
      .returning();

    await db.transaction(async (tx) => {
      const store = new PgVerifierStore(tx as unknown as Database);
      await store.verifyLink(link!.id, new Date());
    });

    // No row is created just to hold a false — absent already means false.
    expect(await db.select().from(userPreferences)).toHaveLength(0);
    const [row] = await db.select().from(gamertagLinks).where(eq(gamertagLinks.id, link!.id));
    expect(row!.status).toBe("verified");
  });
});
