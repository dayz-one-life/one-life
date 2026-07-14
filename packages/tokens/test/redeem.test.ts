import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, servers, gamertagLinks, bans } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getTestDb } from "@onelife/test-support";
import { grant } from "../src/grant.js";
import { redeem } from "../src/redeem.js";
import { getBalance } from "../src/balance.js";
import { TokenError } from "../src/internal.js";

const { db, sql } = getTestDb();
let serverId: number;
const LIFE1 = new Date("2026-07-11T10:00:00Z");
const LIFE2 = new Date("2026-07-12T10:00:00Z");

beforeAll(async () => {
  await db.insert(user).values({ id: "rd1", name: "RD1", email: "rd1@x.com" });
  const [s] = await db.insert(servers).values({ nitradoServiceId: 772001, name: "rd" }).returning();
  serverId = s!.id;
  await db.insert(gamertagLinks).values({ userId: "rd1", serverId, gamertag: "RG1", status: "verified" });
});
afterAll(async () => { await sql.end(); });

describe("redeem", () => {
  it("throws insufficient_tokens: active ban but no token", async () => {
    await db.insert(bans).values({ serverId, gamertag: "RG1", lifeStartedAt: LIFE1, reason: "qualified_death", bannedAt: LIFE1, status: "applied", dryRun: false });
    await expect(redeem(db, { userId: "rd1" })).rejects.toThrow(TokenError);
    expect(await getBalance(db, "rd1")).toBe(0);
  });

  it("spends a token and sets an APPLIED ban to lift_pending", async () => {
    await grant(db, { userId: "rd1", kind: "verification", idempotencyKey: "verify:rd1" });
    const r = await redeem(db, { userId: "rd1" });
    expect(r.gamertag).toBe("RG1");
    expect(await getBalance(db, "rd1")).toBe(0);
    const [b] = await db.select().from(bans).where(eq(bans.id, r.banId));
    expect(b!.status).toBe("lift_pending");
  });

  it("throws no_active_ban when nothing is liftable", async () => {
    await expect(redeem(db, { userId: "rd1" })).rejects.toThrow(/no_active_ban/);
  });

  it("lifts a PENDING (dry-run) ban straight to lifted", async () => {
    await db.insert(bans).values({ serverId, gamertag: "RG1", lifeStartedAt: LIFE2, reason: "qualified_death", bannedAt: LIFE2, status: "pending", dryRun: true });
    await grant(db, { userId: "rd1", kind: "monthly", idempotencyKey: "monthly:rd1" });
    const r = await redeem(db, { userId: "rd1" });
    const [b] = await db.select().from(bans).where(eq(bans.id, r.banId));
    expect(b!.status).toBe("lifted");
  });
});
