import { describe, it, expect, beforeEach, afterAll } from "vitest";
import type { Database } from "@onelife/db";
import { user, gamertagLinks, userPreferences } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { eq } from "drizzle-orm";
import { PgVerifierStore } from "../src/pg-store.js";

const { db, sql } = getTestDb();

beforeEach(async () => {
  await sql`truncate table user_preferences, gamertag_links, "user" restart identity cascade`;
  await db.insert(user).values({ id: "vr", name: "VR", email: "vr@x.com" });
});
afterAll(async () => { await sql.end(); });

describe("verifyLink consent reset", () => {
  it("resets both master switches when a link is verified", async () => {
    const [link] = await db.insert(gamertagLinks)
      .values({ userId: "vr", gamertag: "ResetMe", status: "pending" })
      .returning();
    await db.insert(userPreferences)
      .values({ userId: "vr", sharePresence: true, shareLocation: true });

    await db.transaction(async (tx) => {
      const store = new PgVerifierStore(tx as unknown as Database);
      await store.verifyLink(link!.id, new Date());
    });

    const [prefs] = await db.select().from(userPreferences).where(eq(userPreferences.userId, "vr"));
    expect(prefs!.sharePresence).toBe(false);
    expect(prefs!.shareLocation).toBe(false);
  });

  it("is a no-op for a first-time verifier with no preferences row", async () => {
    const [link] = await db.insert(gamertagLinks)
      .values({ userId: "vr", gamertag: "FirstTime", status: "pending" })
      .returning();

    await db.transaction(async (tx) => {
      const store = new PgVerifierStore(tx as unknown as Database);
      await store.verifyLink(link!.id, new Date());
    });

    // No row is created just to hold two falses — absent already means false.
    expect(await db.select().from(userPreferences)).toHaveLength(0);
    const [row] = await db.select().from(gamertagLinks).where(eq(gamertagLinks.id, link!.id));
    expect(row!.status).toBe("verified");
  });
});
