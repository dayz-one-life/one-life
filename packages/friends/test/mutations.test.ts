import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { user, gamertagLinks, friendships, notifications } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { eq } from "drizzle-orm";
import { request, cancel, accept, decline, remove } from "../src/mutations.js";

const { db, sql } = getTestDb();

// Ids are chosen so ordering is obvious: "fa" < "fb" < "fc".
async function seed() {
  await sql`truncate table friendships, notifications, gamertag_links, "user" restart identity cascade`;
  await db.insert(user).values([
    { id: "fa", name: "FA", email: "fa@x.com" },
    { id: "fb", name: "FB", email: "fb@x.com" },
    { id: "fc", name: "FC", email: "fc@x.com" }, // unverified
  ]);
  await db.insert(gamertagLinks).values([
    { userId: "fa", gamertag: "AlphaOne", status: "verified" },
    { userId: "fb", gamertag: "BravoTwo", status: "verified" },
    { userId: "fc", gamertag: "CharlieX", status: "pending" },
  ]);
}

beforeEach(seed);
afterAll(async () => { await sql.end(); });

const rows = () => db.select().from(friendships);
const notes = () => db.select().from(notifications);

describe("request", () => {
  it("creates a pending row in canonical order regardless of direction", async () => {
    await request(db, { fromUserId: "fb", toUserId: "fa" });
    const [r] = await rows();
    expect(r!.userA).toBe("fa");
    expect(r!.userB).toBe("fb");
    expect(r!.status).toBe("pending");
    expect(r!.requestedBy).toBe("fb");
    expect(r!.requestSeq).toBe(1);
  });

  it("notifies the recipient, naming the sender's gamertag", async () => {
    await request(db, { fromUserId: "fa", toUserId: "fb" });
    const [n] = await notes();
    expect(n!.userId).toBe("fb");
    expect(n!.kind).toBe("friend_request_received");
    expect(n!.body).toBe("AlphaOne wants to be friends.");
    expect(n!.href).toBe("/friends");
  });

  it("rejects a request to yourself", async () => {
    await expect(request(db, { fromUserId: "fa", toUserId: "fa" })).rejects.toThrow(/self_request/);
  });

  it("rejects a request involving an unverified user", async () => {
    await expect(request(db, { fromUserId: "fa", toUserId: "fc" })).rejects.toThrow(/not_verified/);
    await expect(request(db, { fromUserId: "fc", toUserId: "fa" })).rejects.toThrow(/not_verified/);
  });

  it("rejects a duplicate pending request", async () => {
    await request(db, { fromUserId: "fa", toUserId: "fb" });
    await expect(request(db, { fromUserId: "fa", toUserId: "fb" })).rejects.toThrow(/already_pending/);
  });

  // ⚠️ Regression guard for the reciprocal-collision recovery: when two users request each
  // other simultaneously with NO prior row, both transactions insert and one loses the
  // friendships_pair_uniq race. The catch block tries to recover by re-reading the pair, but
  // without a nested transaction/savepoint around the failed insert, Postgres has already
  // aborted the whole outer transaction — the very next statement (lockPair) fails with
  // 25P02 "current transaction is aborted", which escapes uncaught and the caller sees a raw
  // 500 instead of the auto-accept.
  //
  // A plain Promise.all of two request() calls (fa→fb and fb→fa fired concurrently) does NOT
  // reproduce this reliably: against this local Postgres, one call's insert consistently
  // commits before the other's `lockPair` SELECT even runs, so the second call takes the
  // ordinary "existing pending row" branch and never reaches the INSERT that would conflict —
  // proving nothing about the race (confirmed empirically while writing this test: 5/5 runs of
  // a bare Promise.all landed on the non-colliding path). So the losing insert is forced
  // deterministically instead: a raw, manually-held-open transaction inserts the (fa, fb)
  // pending row first and is kept open (not committed) while request(fb→fa) runs concurrently.
  // Under READ COMMITTED, fb's `lockPair` SELECT can't see the uncommitted row, so it takes the
  // same "no existing row" path a genuine race would — then its INSERT blocks on the held row
  // lock. Only once fb's insert is confirmed blocked (via pg_locks) is the holder transaction
  // committed, at which point Postgres wakes fb's INSERT and it collides for real, exercising
  // the exact recovery path a genuine race would. This proves the SQLSTATE-level bug (a real
  // Postgres transaction abort, not a simulated error) — it does NOT prove the *scheduling*
  // itself is racy under a bare Promise.all in this environment, which is why the setup is
  // forced rather than left to chance.
  it("survives a reciprocal request colliding on the pair-uniqueness insert (forced collision)", async () => {
    let releaseHolder: () => void = () => {};
    const holdOpen = new Promise<void>((resolve) => { releaseHolder = resolve; });

    const holderDone = sql.begin(async (htx) => {
      await htx`insert into friendships (user_a, user_b, status, requested_by, created_at)
                 values ('fa', 'fb', 'pending', 'fa', now())`;
      await holdOpen;
    });

    // Wait for fb's request() to actually be blocked on the held row lock, rather than a fixed
    // sleep — a fixed sleep is exactly the kind of timing assumption this test exists to avoid.
    //
    // ⚠️ Scoped to THIS database and to a statement touching `friendships`. The original form
    // counted every ungranted transactionid lock cluster-wide, so any unrelated suite blocking
    // on any row in any database satisfied it — the poll would return before fb's insert was
    // actually blocked, the holder would commit early, and the collision this test exists to
    // force would silently not happen (a green test proving nothing). That made correctness
    // depend on `fileParallelism: false` holding forever. pg_blocking_pids() asks the precise
    // question instead: is a backend of ours waiting on someone else?
    const blockedBackends = async () => {
      const [row] = await sql<{ count: string }[]>`
        select count(*)::int as count from pg_stat_activity
        where datname = current_database()
          and cardinality(pg_blocking_pids(pid)) > 0
          and query ilike '%friendships%'
      `;
      return Number(row?.count ?? 0);
    };
    const waitForBlockedInsert = async () => {
      for (let i = 0; i < 100; i++) {
        if (await blockedBackends() > 0) return;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error("fb's insert never blocked — the forced collision setup is broken");
    };

    // Assert the pre-condition DETERMINISTICALLY, before anything can be blocked: nothing is
    // waiting yet, so a later match is necessarily fb's insert and not something the predicate
    // picked up by being too loose. (Asserting instead that the poll took >0 iterations would
    // be racing the poll's own first connection handshake — which has to open a NEW connection,
    // since `sql`'s warm one is held by the open holder transaction — against request()'s ~7
    // round trips on an already-warm pool. That is a coin flip on a slow or TLS-enabled box,
    // and it would fail red while the code under test is entirely correct.)
    expect(await blockedBackends()).toBe(0);

    const bPromise = request(db, { fromUserId: "fb", toUserId: "fa" });
    await waitForBlockedInsert();
    releaseHolder();
    await holderDone;

    const b = await bPromise;
    expect(b.status).toBe("accepted");

    const [r] = await rows();
    expect(r!.status).toBe("accepted");
    expect(r!.requestedBy).toBe("fa");

    // The original sender (fa, via the raw holder insert) is owed the accepted notification
    // once fb's colliding request resolves the collision as an auto-accept.
    const accepted = (await notes()).filter((n) => n.kind === "friend_request_accepted");
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.userId).toBe("fa");
  });

  it("auto-accepts when the recipient requests back", async () => {
    await request(db, { fromUserId: "fa", toUserId: "fb" });
    const out = await request(db, { fromUserId: "fb", toUserId: "fa" });
    expect(out.status).toBe("accepted");
    const [r] = await rows();
    expect(r!.status).toBe("accepted");
    // The original sender is told.
    const accepted = (await notes()).filter((n) => n.kind === "friend_request_accepted");
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.userId).toBe("fa");
    expect(accepted[0]!.body).toBe("BravoTwo accepted your friend request.");
  });

  it("blocks a re-request inside the cooldown and permits it after", async () => {
    await request(db, { fromUserId: "fa", toUserId: "fb" });
    const [r] = await rows();
    await decline(db, { userId: "fb", friendshipId: r!.id, now: new Date("2026-07-01T00:00:00Z") });

    await expect(
      request(db, { fromUserId: "fa", toUserId: "fb", now: new Date("2026-07-05T00:00:00Z") }),
    ).rejects.toThrow(/cooldown_active/);

    await request(db, { fromUserId: "fa", toUserId: "fb", now: new Date("2026-07-09T00:00:00Z") });
    const [after] = await rows();
    expect(after!.status).toBe("pending");
    expect(after!.requestSeq).toBe(2);
    expect(after!.respondedAt).toBeNull();
  });

  // ⚠️ Regression guard for spec §4.2. Prove this fails first with a natural key that omits
  // the seq: notifications.natural_key is a plain GLOBAL unique index, so the second
  // request's row is swallowed by onConflictDoNothing and the recipient is never told.
  it("notifies again on a re-request after the cooldown", async () => {
    await request(db, { fromUserId: "fa", toUserId: "fb" });
    const [r] = await rows();
    await decline(db, { userId: "fb", friendshipId: r!.id, now: new Date("2026-07-01T00:00:00Z") });
    await request(db, { fromUserId: "fa", toUserId: "fb", now: new Date("2026-07-09T00:00:00Z") });

    const received = (await notes()).filter((n) => n.kind === "friend_request_received");
    expect(received).toHaveLength(2);
    expect(new Set(received.map((n) => n.naturalKey)).size).toBe(2);
  });

  it("rate-limits outgoing requests", async () => {
    // 20 successful requests to fresh users, then the 21st is refused.
    for (let i = 0; i < 20; i++) {
      const id = `r${i}`;
      await db.insert(user).values({ id, name: id, email: `${id}@x.com` });
      await db.insert(gamertagLinks).values({ userId: id, gamertag: `Rate${i}`, status: "verified" });
      await request(db, { fromUserId: "fa", toUserId: id });
    }
    await expect(request(db, { fromUserId: "fa", toUserId: "fb" })).rejects.toThrow(/rate_limited/);
  });

  // ⚠️ Regression guard: cancel() hard-deletes the friendships row but never the
  // notification it already wrote. A counter that counts friendships rows is trivially
  // evaded by request→cancel against fresh targets, defeating the whole point of the
  // limit (bounding notification spam to a target). Counting notifications actually sent
  // closes it. Verified to fail against the old friendships-counting implementation.
  it("still rate-limits when each request is immediately cancelled", async () => {
    for (let i = 0; i < 20; i++) {
      const id = `c${i}`;
      await db.insert(user).values({ id, name: id, email: `${id}@x.com` });
      await db.insert(gamertagLinks).values({ userId: id, gamertag: `Can${i}`, status: "verified" });
      const out = await request(db, { fromUserId: "fa", toUserId: id });
      await cancel(db, { userId: "fa", friendshipId: out.id });
    }
    expect(await rows()).toHaveLength(0);
    await expect(request(db, { fromUserId: "fa", toUserId: "fb" })).rejects.toThrow(/rate_limited/);
  });

  // ⚠️ Regression guard for finding #1: the rate limit is bypassable under concurrency. All
  // 200 requests fire via Promise.all against 200 distinct fresh targets, so with no
  // per-sender serialization every transaction reads count=0 before any of them commits and
  // all 200 pass the `>= 20` check. Fired concurrently, not sequentially, or this proves
  // nothing (a sequential loop would already pass against the unfixed code).
  it("rate-limits concurrent requests from one sender, never exceeding the daily limit", async () => {
    const targets = Array.from({ length: 200 }, (_, i) => `conc${i}`);
    await db.insert(user).values(targets.map((id) => ({ id, name: id, email: `${id}@x.com` })));
    await db.insert(gamertagLinks).values(
      targets.map((id, i) => ({ userId: id, gamertag: `Conc${i}`, status: "verified" as const })),
    );

    const results = await Promise.allSettled(
      targets.map((id) => request(db, { fromUserId: "fa", toUserId: id })),
    );
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const rateLimited = results.filter(
      (r) => r.status === "rejected" && /rate_limited/.test(String((r as PromiseRejectedResult).reason)),
    ).length;

    expect(succeeded).toBeLessThanOrEqual(20);
    expect(succeeded + rateLimited).toBe(200);
    const pendingRows = await rows();
    expect(pendingRows.length).toBeLessThanOrEqual(20);
  });

  // ⚠️ Regression guard for LIKE wildcard bug: user IDs containing `_` were treated as
  // wildcards in the LIKE pattern, matching other users' IDs that differ only at that
  // position. The pattern "friend_request:ab_cd:%" would match "friend_request:abXcd:%"
  // because `_` in the pattern matches any single character X in the data, causing false
  // rate limit denials. The rate-limit query intentionally still uses LIKE (with a
  // `text_pattern_ops` index, migration 0019) rather than `starts_with()`, because
  // `starts_with()` cannot use that index and this query runs on every friend request
  // against an unbounded table (finding #2) — the fix is escaping the sender-id prefix via
  // `escapeLikePattern` before it goes into the LIKE pattern, not swapping LIKE out. Verified
  // to fail against the unescaped-LIKE implementation.
  it("does not confuse rate limits across users with similar IDs containing wildcards", async () => {
    const senderWithUnderscore = "ab_cd";
    const differentSender = "abXcd"; // differs only at the _ position

    // Create both users and verify them
    await db.insert(user).values([
      { id: senderWithUnderscore, name: "Under", email: "under@x.com" },
      { id: differentSender, name: "Different", email: "different@x.com" },
    ]);
    await db.insert(gamertagLinks).values([
      { userId: senderWithUnderscore, gamertag: "UnderTag", status: "verified" },
      { userId: differentSender, gamertag: "DiffTag", status: "verified" },
    ]);

    // Have differentSender send 20 requests to fill their quota
    for (let i = 0; i < 20; i++) {
      const targetId = `dt${i}`;
      await db.insert(user).values({ id: targetId, name: targetId, email: `${targetId}@x.com` });
      await db.insert(gamertagLinks).values({
        userId: targetId,
        gamertag: `DT${i}`,
        status: "verified",
      });
      await request(db, { fromUserId: differentSender, toUserId: targetId });
    }

    // senderWithUnderscore should still be able to send
    // (the LIKE bug would have made this incorrectly rate-limited)
    const finalTarget = "final";
    await db.insert(user).values({ id: finalTarget, name: finalTarget, email: `${finalTarget}@x.com` });
    await db.insert(gamertagLinks).values({
      userId: finalTarget,
      gamertag: "Final",
      status: "verified",
    });

    await expect(request(db, { fromUserId: senderWithUnderscore, toUserId: finalTarget }))
      .resolves.toBeDefined();
  });

  // ⚠️ Two-sided guard alongside the `_` case above: an unescaped `%` in a LIKE pattern is an
  // any-length wildcard. senderWithPercent's own key prefix "friend_request:fa%:" — unescaped
  // — becomes "match anything starting with friend_request:fa", which is satisfied by keys
  // belonging to the UNRELATED sender "fa" (e.g. "friend_request:fa:1:1": "fa" matches the
  // literal head, "%" swallows the empty remainder up to the next ":", satisfying the
  // trailing "...:%"). That would over-count senderWithPercent's own quota using another
  // user's traffic and permanently rate-limit it regardless of how few requests
  // senderWithPercent itself has sent. Verified to fail against an unescaped-LIKE
  // implementation.
  it("does not let a % in a user id turn the rate-limit prefix into a wildcard", async () => {
    const senderWithPercent = "fa%";

    await db.insert(user).values({ id: senderWithPercent, name: "Percent", email: "percent@x.com" });
    await db.insert(gamertagLinks).values({ userId: senderWithPercent, gamertag: "PercentTag", status: "verified" });

    // The unrelated sender "fa" sends 20 requests to fill ITS OWN quota. None of these should
    // count against senderWithPercent.
    for (let i = 0; i < 20; i++) {
      const targetId = `pt${i}`;
      await db.insert(user).values({ id: targetId, name: targetId, email: `${targetId}@x.com` });
      await db.insert(gamertagLinks).values({ userId: targetId, gamertag: `PT${i}`, status: "verified" });
      await request(db, { fromUserId: "fa", toUserId: targetId });
    }

    // senderWithPercent should still be able to send its first request — an unescaped % would
    // have it read as already rate-limited by fa's unrelated requests.
    await expect(request(db, { fromUserId: senderWithPercent, toUserId: "fb" }))
      .resolves.toBeDefined();
  });
});

describe("accept / decline / cancel / remove", () => {
  async function pending() {
    await request(db, { fromUserId: "fa", toUserId: "fb" });
    const [r] = await rows();
    return r!.id;
  }

  it("accepts and notifies the original sender", async () => {
    const id = await pending();
    await accept(db, { userId: "fb", friendshipId: id });
    const [r] = await rows();
    expect(r!.status).toBe("accepted");
    expect(r!.respondedAt).not.toBeNull();
    const accepted = (await notes()).filter((n) => n.kind === "friend_request_accepted");
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.userId).toBe("fa");
  });

  it("refuses to let the sender accept their own request", async () => {
    const id = await pending();
    await expect(accept(db, { userId: "fa", friendshipId: id })).rejects.toThrow(/not_recipient/);
  });

  it("declines without notifying anyone", async () => {
    const id = await pending();
    const before = (await notes()).length;
    await decline(db, { userId: "fb", friendshipId: id });
    const [r] = await rows();
    expect(r!.status).toBe("declined");
    expect(r!.respondedAt).not.toBeNull();
    expect((await notes()).length).toBe(before);
  });

  it("lets the sender cancel a pending request, deleting the row", async () => {
    const id = await pending();
    await cancel(db, { userId: "fa", friendshipId: id });
    expect(await rows()).toHaveLength(0);
  });

  it("refuses to let the recipient cancel", async () => {
    const id = await pending();
    await expect(cancel(db, { userId: "fb", friendshipId: id })).rejects.toThrow(/not_found/);
  });

  it("removes an accepted friendship from either side, deleting the row", async () => {
    const id = await pending();
    await accept(db, { userId: "fb", friendshipId: id });
    await remove(db, { userId: "fa", friendshipId: id });
    expect(await rows()).toHaveLength(0);
  });

  it("rejects a mutation from someone who is not a party", async () => {
    const id = await pending();
    await expect(remove(db, { userId: "fc", friendshipId: id })).rejects.toThrow(/not_found/);
    await expect(accept(db, { userId: "fc", friendshipId: id })).rejects.toThrow(/not_recipient/);
  });
});
