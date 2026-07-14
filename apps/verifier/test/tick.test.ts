import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, admFiles, players, user, gamertagLinks, verificationChallenges, events } from "@onelife/db";
import { and, eq, inArray, sql as sqlExpr } from "drizzle-orm";
import { appendEvent, setCursor } from "@onelife/event-log";
import { verifierTick } from "../src/tick.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 5e8;
const consumer = `verifier-${svc}`;
const uid = `u-verifier-${svc}`;
const uidB = `u-verifier-b-${svc}`;
let serverId: number;
let serverId2: number;
let admFileId: number;
let admFileId2: number;
let lineCounter = 0;
let lineCounter2 = 0;

const SEQ = ["EmoteSalute", "EmoteDance", "EmoteShrug"];
const issuedAt = new Date("2026-07-09T00:00:00Z");
const expiresAt = new Date("2026-07-10T00:00:00Z");

async function seedEmote(gamertag: string, token: string, at: string): Promise<void> {
  await appendEvent(db, {
    serverId, admFileId, lineIndex: lineCounter++, subIndex: 0,
    type: "emote.performed" as any, occurredAt: new Date(at),
    payload: { gamertag, emote: token, item: null, x: 0, y: 0 },
  });
}

// Seeds on the SECOND server — used to prove challenge matching is server-agnostic.
async function seedEmoteOnServer2(gamertag: string, token: string, at: string): Promise<void> {
  await appendEvent(db, {
    serverId: serverId2, admFileId: admFileId2, lineIndex: lineCounter2++, subIndex: 0,
    type: "emote.performed" as any, occurredAt: new Date(at),
    payload: { gamertag, emote: token, item: null, x: 0, y: 0 },
  });
}

async function newChallenge(gamertag: string, userId: string): Promise<{ linkId: number; challengeId: number }> {
  const [link] = await db.insert(gamertagLinks).values({ userId, gamertag, status: "pending" }).returning();
  const [ch] = await db.insert(verificationChallenges).values({
    gamertagLinkId: link!.id, sequence: SEQ, issuedAt, expiresAt,
  }).returning();
  return { linkId: link!.id, challengeId: ch!.id };
}

async function status(linkId: number): Promise<string> {
  const r = await db.select({ s: gamertagLinks.status }).from(gamertagLinks).where(eq(gamertagLinks.id, linkId));
  return r[0]!.s;
}

beforeAll(async () => {
  const before = await db.select({ m: sqlExpr<number>`coalesce(max(${events.id}), 0)` }).from(events);
  await setCursor(db, consumer, Number(before[0]!.m));

  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "verifier-test" }).returning();
  serverId = s!.id;
  const [f] = await db.insert(admFiles).values({ serverId, path: `/t/${svc}.ADM`, name: "t.ADM" }).returning();
  admFileId = f!.id;

  const svc2 = svc + 1;
  const [s2] = await db.insert(servers).values({ nitradoServiceId: svc2, name: "verifier-test-2" }).returning();
  serverId2 = s2!.id;
  const [f2] = await db.insert(admFiles).values({ serverId: serverId2, path: `/t/${svc2}.ADM`, name: "t2.ADM" }).returning();
  admFileId2 = f2!.id;

  await db.insert(players).values({ gamertag: "Alice", dayzId: "A=" });
  await db.insert(players).values({ gamertag: "Bob", dayzId: "B=" });
  await db.insert(players).values({ gamertag: "Carol", dayzId: "C=" });
  await db.insert(players).values({ gamertag: "G", dayzId: `G=${svc}` });
  await db.insert(user).values({ id: uid, name: "A", email: `${uid}@x.com` });
  await db.insert(user).values({ id: uidB, name: "B", email: `${uidB}@x.com` });
});

afterAll(async () => {
  await db.delete(verificationChallenges).where(
    sqlExpr`${verificationChallenges.gamertagLinkId} IN (SELECT id FROM gamertag_links WHERE user_id IN (${uid}, ${uidB}))`);
  await db.delete(gamertagLinks).where(inArray(gamertagLinks.userId, [uid, uidB]));
  await db.delete(players).where(inArray(players.gamertag, ["Alice", "Bob", "Carol", "G"]));
  await db.delete(user).where(eq(user.id, uid));
  await db.delete(user).where(eq(user.id, uidB));
  await sql.end();
});

describe("verifierTick", () => {
  it("verifies a link when the full sequence is performed in order (interleaved emotes ignored)", async () => {
    const { linkId } = await newChallenge("Alice", uid);
    await seedEmote("Alice", "EmoteSalute", "2026-07-09T01:00:00Z");
    await seedEmote("Alice", "EmoteHeart", "2026-07-09T01:01:00Z"); // ignored (non-matching)
    await seedEmote("Alice", "EmoteDance", "2026-07-09T01:02:00Z");
    await seedEmote("Alice", "EmoteShrug", "2026-07-09T01:03:00Z");

    const r = await verifierTick(db, { batchSize: 100, consumerName: consumer });
    expect(r.verified).toBe(1);
    expect(await status(linkId)).toBe("verified");

    const r2 = await verifierTick(db, { batchSize: 100, consumerName: consumer }); // idempotent
    expect(r2.verified).toBe(0);
    expect(await status(linkId)).toBe("verified");
  });

  it("ignores emotes performed before the challenge was issued", async () => {
    const { linkId } = await newChallenge("Bob", uid);
    // all three BEFORE issuedAt -> must not count
    await seedEmote("Bob", "EmoteSalute", "2026-07-08T23:00:00Z");
    await seedEmote("Bob", "EmoteDance", "2026-07-08T23:01:00Z");
    await seedEmote("Bob", "EmoteShrug", "2026-07-08T23:02:00Z");
    await verifierTick(db, { batchSize: 100, consumerName: consumer });
    expect(await status(linkId)).toBe("pending");
  });

  it("first-verify-wins: cancels the losing user's pending link", async () => {
    // Two distinct users hold pending claims on the SAME gamertag (allowed — the partial
    // unique index only forbids two *verified*). A fresh gamertag avoids the (user,server,
    // gamertag) unique collision with the Bob link created by the previous test.
    const a = await newChallenge("Carol", uid);
    const b = await newChallenge("Carol", uidB);
    await seedEmote("Carol", "EmoteSalute", "2026-07-09T02:00:00Z");
    await seedEmote("Carol", "EmoteDance", "2026-07-09T02:01:00Z");
    await seedEmote("Carol", "EmoteShrug", "2026-07-09T02:02:00Z");
    await verifierTick(db, { batchSize: 100, consumerName: consumer });
    // Whichever pending link matched first wins; the other is cancelled. Exactly one verified.
    const statuses = [await status(a.linkId), await status(b.linkId)].sort();
    expect(statuses).toEqual(["cancelled", "verified"]);
  });

  it("matches gamertag links globally by gamertag: verifies on ANY server and cancels the other user's pending claim", async () => {
    // Two pending links for gamertag "G" — one per user. Links carry no server at all
    // (gamertag_links is server-agnostic). The emote sequence for "G" is performed entirely
    // on serverId2, a DIFFERENT server than the one used to seed every other fixture in this
    // file (serverId). If matching were still scoped by serverId, these events would never
    // be picked up and the challenge would stay pending forever.
    const a = await newChallenge("G", uid);
    const b = await newChallenge("G", uidB);
    await seedEmoteOnServer2("G", "EmoteSalute", "2026-07-09T03:00:00Z");
    await seedEmoteOnServer2("G", "EmoteDance", "2026-07-09T03:01:00Z");
    await seedEmoteOnServer2("G", "EmoteShrug", "2026-07-09T03:02:00Z");
    await verifierTick(db, { batchSize: 100, consumerName: consumer });
    const statuses = [await status(a.linkId), await status(b.linkId)].sort();
    expect(statuses).toEqual(["cancelled", "verified"]);
  });
});
