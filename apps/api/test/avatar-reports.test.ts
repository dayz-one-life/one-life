import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { avatars, avatarReports, blockedAvatarHashes, gamertagLinks, user } from "@onelife/db";
import { reportAvatar } from "../src/lib/moderation.js";
import { getAvatarByHash, unbanAvatarHash } from "../src/lib/avatar-store.js";

const { db, sql } = getTestDb();
const HASH = "aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111";
const BYTES = Buffer.from([1, 2, 3, 4]);

async function seedUser(id: string) {
  await db.insert(user).values({
    id, name: `user-${id}`, email: `${id}@example.test`, emailVerified: true,
    createdAt: new Date(), updatedAt: new Date(),
  });
}
async function seedVerified(id: string, gamertag: string) {
  await db.insert(gamertagLinks).values({
    userId: id, gamertag, status: "verified", verifiedAt: new Date(), createdAt: new Date(),
  });
}
async function seedAvatar(userId: string, hash: string) {
  await db.insert(avatars).values({ userId, image: BYTES, hash, source: "upload", updatedAt: new Date() });
}

beforeEach(async () => {
  await db.delete(avatarReports);
  await db.delete(blockedAvatarHashes);
  await db.delete(avatars);
  await db.delete(gamertagLinks);
  await db.delete(user);
});
afterAll(async () => {
  // ⚠️ This file shares one Postgres DB with every other test file in the package
  // (vitest.config.ts sets fileParallelism: false, not per-file isolation), so leftover
  // rows here break later files' `db.delete(user)` calls with an FK violation from
  // gamertagLinks. Leave the DB as we found it, same as the other DB-backed test files.
  await db.delete(avatarReports);
  await db.delete(blockedAvatarHashes);
  await db.delete(avatars);
  await db.delete(gamertagLinks);
  await db.delete(user);
  await sql.end();
});

describe("reportAvatar", () => {
  it("bans the subject's hash immediately on the first report", async () => {
    await seedUser("reporter"); await seedVerified("reporter", "ReporterTag");
    await seedUser("subject"); await seedAvatar("subject", HASH);

    expect(await getAvatarByHash(db, HASH)).not.toBeNull();
    const res = await reportAvatar(db, "reporter", HASH, "hate");

    expect(res).toEqual({ ok: true });
    expect(await getAvatarByHash(db, HASH)).toBeNull();
  });

  // ⚠️ The abuse gate. Single-report auto-hide is only tolerable because reporting costs a
  // verified Xbox identity (proven by in-game emote), not a throwaway signup.
  it("rejects a reporter with no verified gamertag link", async () => {
    await seedUser("reporter");
    await seedUser("subject"); await seedAvatar("subject", HASH);

    expect(await reportAvatar(db, "reporter", HASH, "hate")).toEqual({ error: "not_verified" });
    expect(await getAvatarByHash(db, HASH)).not.toBeNull();
  });

  it("rejects a reporter whose link is only pending", async () => {
    await seedUser("reporter");
    await db.insert(gamertagLinks).values({
      userId: "reporter", gamertag: "Pending", status: "pending", createdAt: new Date(),
    });
    await seedUser("subject"); await seedAvatar("subject", HASH);

    expect(await reportAvatar(db, "reporter", HASH, "hate")).toEqual({ error: "not_verified" });
  });

  it("refuses a hash no live avatar holds, so the queue cannot be filled with invented hashes", async () => {
    await seedUser("reporter"); await seedVerified("reporter", "ReporterTag");
    expect(await reportAvatar(db, "reporter", "nosuchhash".padEnd(64, "0"), "hate")).toEqual({ error: "unknown_hash" });
  });

  it("refuses to report bytes you hold yourself", async () => {
    await seedUser("reporter"); await seedVerified("reporter", "ReporterTag");
    await seedAvatar("reporter", HASH);
    expect(await reportAvatar(db, "reporter", HASH, "hate")).toEqual({ error: "self" });
  });

  it("refuses a second report from the same reporter against the same hash", async () => {
    await seedUser("reporter"); await seedVerified("reporter", "ReporterTag");
    await seedUser("subject"); await seedAvatar("subject", HASH);

    await reportAvatar(db, "reporter", HASH, "hate");
    expect(await reportAvatar(db, "reporter", HASH, "other")).toEqual({ error: "already_reported" });

    const rows = await db.select().from(avatarReports);
    expect(rows).toHaveLength(1);
  });

  // The point of hash-keying: two holders, one report, both hidden.
  it("hides the bytes for every holder from a single report", async () => {
    await seedUser("reporter"); await seedVerified("reporter", "ReporterTag");
    await seedUser("a"); await seedAvatar("a", HASH);
    await seedUser("b"); await seedAvatar("b", HASH);
    expect(await reportAvatar(db, "reporter", HASH, "hate")).toEqual({ ok: true });
    expect(await getAvatarByHash(db, HASH)).toBeNull();
  });

  // A second reporter on an already-banned hash records their report but must not create a
  // duplicate ban row — the moderator should see accumulated reports, not duplicate entries.
  it("is idempotent against an already-banned hash", async () => {
    await seedUser("r1"); await seedVerified("r1", "TagOne");
    await seedUser("r2"); await seedVerified("r2", "TagTwo");
    await seedUser("subject"); await seedAvatar("subject", HASH);

    await reportAvatar(db, "r1", HASH, "hate");
    expect(await reportAvatar(db, "r2", HASH, "sexual")).toEqual({ ok: true });

    expect(await db.select().from(avatarReports)).toHaveLength(2);
    expect(await db.select().from(blockedAvatarHashes)).toHaveLength(1);
  });

  it("caps a reporter at 10 reports per rolling 24 hours", async () => {
    await seedUser("reporter"); await seedVerified("reporter", "ReporterTag");
    for (let i = 0; i < 10; i++) {
      await seedUser(`s${i}`);
      await seedAvatar(`s${i}`, `hash-${i}`.padEnd(64, "0"));
      expect(await reportAvatar(db, "reporter", `hash-${i}`.padEnd(64, "0"), "other")).toEqual({ ok: true });
    }
    await seedUser("s10");
    await seedAvatar("s10", "hash-10".padEnd(64, "0"));

    expect(await reportAvatar(db, "reporter", "hash-10".padEnd(64, "0"), "other")).toEqual({ error: "rate_limited" });
  });

  it("does not re-hide a hash a moderator restored", async () => {
    await seedUser("r1"); await seedVerified("r1", "TagOne");
    await seedUser("r2"); await seedVerified("r2", "TagTwo");
    await seedUser("subject"); await seedAvatar("subject", HASH);

    await reportAvatar(db, "r1", HASH, "hate");
    expect(await getAvatarByHash(db, HASH)).toBeNull();

    await unbanAvatarHash(db, HASH, "moderator-1");
    // The restore is DURABLE, not a delete: the bytes serve again...
    expect(await getAvatarByHash(db, HASH)).not.toBeNull();

    // ...and a second verified account cannot immediately undo the human decision.
    // ⚠️ It must also not be TOLD it succeeded. The client renders "This avatar is hidden
    // straight away" on ok:true, which would be a flat lie here — and the queue excludes
    // `allowed` rows, so the report would be invisible to every moderator forever. A distinct
    // outcome is the only honest answer.
    expect(await reportAvatar(db, "r2", HASH, "sexual")).toEqual({ error: "already_reviewed" });
    expect(await getAvatarByHash(db, HASH)).not.toBeNull();
    const bans = await db.select().from(blockedAvatarHashes);
    expect(bans).toHaveLength(1);
    expect(bans[0]?.state).toBe("allowed");
  });

  // ⚠️ The report is still RECORDED, even though it changes nothing about the ban. Refusing to
  // write the row meant a wrongly-restored image accumulated no evidence and had no path back to
  // a human: every later report against it vanished silently, forever. The reporter is still
  // told `already_reviewed` — that part was honest — but the signal now survives to be queried.
  // (Surfacing these in the moderator queue is a separate, deliberately-deferred follow-up.)
  it("still records the report against a restored hash, without re-banning it", async () => {
    await seedUser("r1"); await seedVerified("r1", "TagOne");
    await seedUser("r2"); await seedVerified("r2", "TagTwo");
    await seedUser("subject"); await seedAvatar("subject", HASH);

    await reportAvatar(db, "r1", HASH, "hate");
    await unbanAvatarHash(db, HASH, "moderator-1");

    expect(await reportAvatar(db, "r2", HASH, "sexual")).toEqual({ error: "already_reviewed" });

    // r2's report is on record alongside r1's, attributed and queryable...
    const reports = await db.select().from(avatarReports);
    expect(reports).toHaveLength(2);
    const r2Report = reports.find((r) => r.reporterUserId === "r2");
    expect(r2Report).toMatchObject({ subjectHash: HASH, reason: "sexual", subjectUserId: "subject" });

    // ...and the moderator's restore is untouched: the hash stays unbanned and the bytes serve.
    const bans = await db.select().from(blockedAvatarHashes);
    expect(bans).toHaveLength(1);
    expect(bans[0]?.state).toBe("allowed");
    expect(await getAvatarByHash(db, HASH)).not.toBeNull();
  });

  // The reporter's OWN history still wins over the moderator's restore: a reporter who already
  // filed against these bytes gets `already_reported`, because the unique (reporter, hash) index
  // means there is genuinely nothing new to record.
  it("tells a REPEAT reporter already_reported, not already_reviewed", async () => {
    await seedUser("r1"); await seedVerified("r1", "TagOne");
    await seedUser("subject"); await seedAvatar("subject", HASH);

    await reportAvatar(db, "r1", HASH, "hate");
    await unbanAvatarHash(db, HASH, "moderator-1");

    expect(await reportAvatar(db, "r1", HASH, "sexual")).toEqual({ error: "already_reported" });
    expect(await db.select().from(avatarReports)).toHaveLength(1);
  });

  // ⚠️ Finding 4. Split across two statements, a failed ban left an un-retryable report row
  // behind (unique (reporter, hash)) and the avatar silently stayed visible.
  it("rolls the report back when the ban fails, so the reporter can retry", async () => {
    await seedUser("reporter"); await seedVerified("reporter", "ReporterTag");
    await seedUser("subject"); await seedAvatar("subject", HASH);

    // Force the ban half to fail: the state column is text, but the hash column is the PK and a
    // NOT NULL violation inside the same transaction proves atomicity just as well. Simplest
    // faithful failure: drop the table's insert privilege for the duration.
    await sql`ALTER TABLE blocked_avatar_hashes ADD CONSTRAINT tmp_no_inserts CHECK (hash = 'never')`;
    try {
      await expect(reportAvatar(db, "reporter", HASH, "hate")).rejects.toThrow();
    } finally {
      await sql`ALTER TABLE blocked_avatar_hashes DROP CONSTRAINT tmp_no_inserts`;
    }

    // The report row must NOT have survived the failed ban.
    expect(await db.select().from(avatarReports)).toHaveLength(0);
    // ...so the same reporter can retry and auto-hide actually happens.
    expect(await reportAvatar(db, "reporter", HASH, "hate")).toEqual({ ok: true });
    expect(await getAvatarByHash(db, HASH)).toBeNull();
  });
});
