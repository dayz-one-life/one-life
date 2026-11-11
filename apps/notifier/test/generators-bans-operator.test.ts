import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, servers, gamertagLinks, bans } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getTestDb } from "@onelife/test-support";
import { banLiftedGenerator, liftedBody } from "../src/generators/bans.js";

/** ⚠️ Invented users and gamertags only. A window of its own, in 2032, so no other fixture is in it. */
const { db, sql } = getTestDb();
const NOW = new Date("2032-03-10T12:00:00Z");
const deps = { db, now: NOW, since: new Date("2032-01-01T00:00:00Z"), lookbackHours: 24, siteUrl: "https://s" };
let serverId: number;
let operatorBan: number, tokenBan: number, oldRowBan: number;

beforeAll(async () => {
  await db.insert(user).values({ id: "bnop1", name: "BNOP1", email: "bnop1@x.com" });
  const [s] = await db.insert(servers).values({ nitradoServiceId: 991077, name: "opsrv", slug: "opsrv" }).returning();
  serverId = s!.id;
  await db.insert(gamertagLinks).values({ userId: "bnop1", gamertag: "Operator Lifted One", status: "verified", verifiedAt: new Date("2032-01-02T00:00:00Z") });
  const row = (h: number, liftReason: string | null) => ({
    serverId, gamertag: "Operator Lifted One", lifeStartedAt: new Date(`2032-03-0${h}T00:00:00Z`), reason: "qualified_death",
    bannedAt: new Date(`2032-03-0${h}T01:00:00Z`), expiresAt: new Date(`2032-03-0${h + 1}T01:00:00Z`), status: "lifted", dryRun: false,
    liftedAt: new Date(`2032-03-10T0${h}:00:00Z`), liftReason,
  });
  const ids = await db.insert(bans).values([row(1, "operator"), row(2, "token"), row(3, null)]).returning({ id: bans.id });
  [operatorBan, tokenBan, oldRowBan] = ids.map((r) => Number(r.id)) as [number, number, number];
});
afterAll(async () => {
  await db.delete(bans).where(eq(bans.serverId, serverId));
  await db.delete(gamertagLinks).where(eq(gamertagLinks.userId, "bnop1"));
  await db.delete(servers).where(eq(servers.id, serverId));
  await db.delete(user).where(eq(user.id, "bnop1"));
  await sql.end();
});

describe("ban_lifted after an operator lift (death-verdict spec 6.4)", () => {
  it("an operator lift does not say a token was spent", async () => {
    const drafts = await banLiftedGenerator(deps);
    const body = (id: number) => drafts.find((d) => d.naturalKey === `ban_lifted:${id}`)!.body;
    expect(body(operatorBan)).toBe("opsrv: the ban was lifted by the server operator.");
    expect(body(operatorBan)).not.toMatch(/token/i);
    expect(body(tokenBan)).toBe("opsrv: your token was spent and the ban is lifted.");
    expect(body(oldRowBan)).toBe("opsrv: your token was spent and the ban is lifted."); // NULL reads as token
  });

  it("an expiry reads as an expiry whatever the lift reason", () => {
    expect(liftedBody("S", "expired", "operator")).toBe("S: your ban has expired. Go start a new life.");
  });
});
