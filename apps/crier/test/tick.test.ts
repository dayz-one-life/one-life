import { describe, it, expect, vi } from "vitest";
import { crierTick, type CrierDeps } from "../src/tick.js";
import type { Config } from "../src/config.js";

const cfg = (over: Partial<Config> = {}): Config => ({
  databaseUrl: "x", siteUrl: "https://dayzonelife.com", intervalSeconds: 60,
  since: new Date("2026-07-31T00:00:00Z"), dryRun: false, batchCap: 10, maxAttempts: 5,
  discordWebhookUrl: "https://discord.test/hook",
  fbPageId: "990", fbPageAccessToken: "tok",
  reddit: null, redditMinIntervalSeconds: 600,
  logLevel: "silent", ...over,
});

const target = (slug: string, channel: string) => ({ slug, headline: `H ${slug}`, lede: `L ${slug}`, channel });

function deps(over: Partial<CrierDeps> = {}): CrierDeps {
  return {
    cfg: cfg(),
    fetchFn: vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    now: new Date("2026-07-31T12:00:00Z"),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    store: {
      findSyndicationTargets: vi.fn().mockResolvedValue([]),
      recordSuccess: vi.fn().mockResolvedValue(undefined),
      recordFailure: vi.fn().mockResolvedValue(undefined),
      lastPostedAt: vi.fn().mockResolvedValue(null),
    },
    sleep: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

const db = {} as never;

describe("crierTick", () => {
  it("does nothing when since is null", async () => {
    const d = deps({ cfg: cfg({ since: null }) });
    const r = await crierTick(db, d);
    expect(r).toEqual({ posted: 0, failed: 0, skipped: 0, deferred: 0, dryRun: false });
    expect(d.store.findSyndicationTargets).not.toHaveBeenCalled();
  });

  it("does nothing when no channel is configured", async () => {
    const d = deps({ cfg: cfg({ discordWebhookUrl: null, fbPageId: null, fbPageAccessToken: null, reddit: null }) });
    await crierTick(db, d);
    expect(d.store.findSyndicationTargets).not.toHaveBeenCalled();
  });

  it("dry-run: logs targets, makes zero external calls and zero writes", async () => {
    const d = deps({ cfg: cfg({ dryRun: true }) });
    d.store.findSyndicationTargets = vi.fn().mockResolvedValue([target("a", "discord"), target("a", "facebook")]);
    const r = await crierTick(db, d);
    expect(r).toEqual({ posted: 0, failed: 0, skipped: 2, deferred: 0, dryRun: true });
    expect(d.fetchFn).not.toHaveBeenCalled();
    expect(d.store.recordSuccess).not.toHaveBeenCalled();
    expect(d.store.recordFailure).not.toHaveBeenCalled();
  });

  it("posts each target to its channel with the obituary URL and records success", async () => {
    const d = deps();
    d.store.findSyndicationTargets = vi.fn().mockResolvedValue([target("a", "discord"), target("a", "facebook")]);
    const r = await crierTick(db, d);
    expect(r.posted).toBe(2);
    const urls = (d.fetchFn as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(urls).toContain("https://discord.test/hook");
    expect(urls).toContain("https://graph.facebook.com/v21.0/990/feed");
    const discordBody = JSON.parse((d.fetchFn as ReturnType<typeof vi.fn>).mock.calls
      .find((c) => String(c[0]).includes("discord"))![1].body);
    expect(discordBody.content).toContain("https://dayzonelife.com/obituaries/a");
    expect(d.store.recordSuccess).toHaveBeenCalledWith(db, "a", "discord", d.now);
    expect(d.store.recordSuccess).toHaveBeenCalledWith(db, "a", "facebook", d.now);
  });

  it("a discord failure records failure but still posts facebook (independent channels)", async () => {
    const d = deps();
    d.fetchFn = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes("discord") ? new Response("boom", { status: 500 }) : new Response("{}", { status: 200 }),
    ) as unknown as typeof fetch;
    d.store.findSyndicationTargets = vi.fn().mockResolvedValue([target("a", "discord"), target("a", "facebook")]);
    const r = await crierTick(db, d);
    expect(r.posted).toBe(1);
    expect(r.failed).toBe(1);
    expect(d.store.recordFailure).toHaveBeenCalledWith(db, "a", "discord", expect.stringContaining("500"));
    expect(d.store.recordSuccess).toHaveBeenCalledWith(db, "a", "facebook", d.now);
  });

  it("sleeps between consecutive live posts", async () => {
    const d = deps();
    d.store.findSyndicationTargets = vi.fn().mockResolvedValue([target("a", "discord"), target("b", "discord")]);
    await crierTick(db, d);
    expect(d.sleep).toHaveBeenCalledTimes(1); // between the two posts, not after the last
    expect(d.sleep).toHaveBeenCalledWith(2000);
  });

  it("passes the enabled channel list, cap, attempts and since through to the store", async () => {
    const d = deps({ cfg: cfg({ fbPageId: null, fbPageAccessToken: null }) });
    await crierTick(db, d);
    expect(d.store.findSyndicationTargets).toHaveBeenCalledWith(db, {
      channels: ["discord"], since: cfg().since, maxAttempts: 5, limit: 10,
    });
  });
});

describe("reddit channel in the tick", () => {
  const redditCfg = {
    clientId: "cid", clientSecret: "csec", refreshToken: "rtok",
    subreddit: "dayzonelife", userAgent: "onelife-crier/1.0", flairId: null,
  };
  // A token mint and a submit both return 200 JSON; the provider reads access_token, the
  // submitter reads json.errors.
  const redditFetch = () =>
    vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes("access_token")
        ? new Response(JSON.stringify({ access_token: "acc", expires_in: 3600 }), { status: 200 })
        : new Response(JSON.stringify({ json: { errors: [] } }), { status: 200 }),
    ) as unknown as typeof fetch;

  const redditDeps = (over: Partial<CrierDeps> = {}) => {
    const d = deps({ cfg: cfg({ reddit: redditCfg, discordWebhookUrl: null, fbPageId: null, fbPageAccessToken: null }), ...over });
    d.fetchFn = redditFetch();
    return d;
  };

  it("includes reddit in the channel list only when configured", async () => {
    const off = deps();
    await crierTick(db, off);
    expect(off.store.findSyndicationTargets).toHaveBeenCalledWith(db, expect.objectContaining({ channels: ["discord", "facebook"] }));
    const on = redditDeps();
    await crierTick(db, on);
    expect(on.store.findSyndicationTargets).toHaveBeenCalledWith(db, expect.objectContaining({ channels: ["reddit"] }));
  });

  it("submits a link post to the configured subreddit", async () => {
    const d = redditDeps();
    d.store.findSyndicationTargets = vi.fn().mockResolvedValue([target("a", "reddit")]);
    const r = await crierTick(db, d);
    expect(r.posted).toBe(1);
    const submit = (d.fetchFn as ReturnType<typeof vi.fn>).mock.calls.find((c) => String(c[0]).includes("/api/submit"))!;
    const body = submit[1].body as URLSearchParams;
    expect(body.get("sr")).toBe("dayzonelife");
    expect(body.get("kind")).toBe("link");
    expect(body.get("url")).toBe("https://dayzonelife.com/obituaries/a");
    expect(d.store.recordSuccess).toHaveBeenCalledWith(db, "a", "reddit", d.now);
  });

  // ⚠️ THE landmine. A rate-cap deferral is neither a success nor a failure. Recording it as a
  // failure would burn an attempt, and at CRIER_MAX_ATTEMPTS=5 five minutes of ordinary rate
  // limiting would poison every queued row permanently — the channel goes silent with no error
  // anywhere. The assertion that matters is the ABSENCE of the recordFailure call.
  it("defers a reddit row inside the rate window WITHOUT burning an attempt", async () => {
    const d = redditDeps();
    d.store.lastPostedAt = vi.fn().mockResolvedValue(new Date("2026-07-31T11:55:00Z")); // 5 min before now
    d.store.findSyndicationTargets = vi.fn().mockResolvedValue([target("a", "reddit")]);
    const r = await crierTick(db, d);
    expect(r).toMatchObject({ posted: 0, failed: 0, deferred: 1 });
    expect(d.store.recordFailure).not.toHaveBeenCalled();
    expect(d.store.recordSuccess).not.toHaveBeenCalled();
    expect((d.fetchFn as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).includes("/api/submit"))).toBe(false);
  });

  it("posts once the rate window has elapsed", async () => {
    const d = redditDeps();
    d.store.lastPostedAt = vi.fn().mockResolvedValue(new Date("2026-07-31T11:45:00Z")); // 15 min before now
    d.store.findSyndicationTargets = vi.fn().mockResolvedValue([target("a", "reddit")]);
    expect((await crierTick(db, d)).posted).toBe(1);
  });

  // Two reddit rows in one tick must not both go out: the second is deferred against the first.
  it("applies the cap within a single tick, not just across ticks", async () => {
    const d = redditDeps();
    d.store.findSyndicationTargets = vi.fn().mockResolvedValue([target("a", "reddit"), target("b", "reddit")]);
    const r = await crierTick(db, d);
    expect(r).toMatchObject({ posted: 1, deferred: 1 });
    expect(d.store.recordFailure).not.toHaveBeenCalled();
  });

  it("dry-run reports reddit rows regardless of the rate cap", async () => {
    const d = redditDeps({ cfg: cfg({ reddit: redditCfg, dryRun: true, discordWebhookUrl: null, fbPageId: null, fbPageAccessToken: null }) });
    d.store.lastPostedAt = vi.fn().mockResolvedValue(new Date("2026-07-31T11:59:00Z"));
    d.store.findSyndicationTargets = vi.fn().mockResolvedValue([target("a", "reddit")]);
    const r = await crierTick(db, d);
    expect(r).toMatchObject({ skipped: 1, deferred: 0 });
  });

  // ⚠️ The dispatch regression. tick.ts used to read `if discord … else facebook`, so ANY third
  // channel silently posted to Facebook. This pins each channel to its own host.
  it("routes each channel to its own destination", async () => {
    const d = deps({ cfg: cfg({ reddit: redditCfg }) });
    d.fetchFn = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes("access_token")
        ? new Response(JSON.stringify({ access_token: "acc", expires_in: 3600 }), { status: 200 })
        : new Response(JSON.stringify({ json: { errors: [] } }), { status: 200 }),
    ) as unknown as typeof fetch;
    d.store.findSyndicationTargets = vi.fn().mockResolvedValue([
      target("a", "discord"), target("a", "facebook"), target("a", "reddit"),
    ]);
    await crierTick(db, d);
    const hosts = (d.fetchFn as ReturnType<typeof vi.fn>).mock.calls.map((c) => new URL(String(c[0])).host);
    expect(hosts).toContain("discord.test");
    expect(hosts).toContain("graph.facebook.com");
    expect(hosts).toContain("oauth.reddit.com");
  });

  it("a reddit failure does not stop the same obituary reaching discord", async () => {
    const d = deps({ cfg: cfg({ reddit: redditCfg }) });
    d.fetchFn = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("access_token")) return new Response(JSON.stringify({ access_token: "acc", expires_in: 3600 }), { status: 200 });
      // 200 carrying json.errors — the Reddit-specific failure shape.
      if (u.includes("reddit")) return new Response(JSON.stringify({ json: { errors: [["RATELIMIT", "slow down"]] } }), { status: 200 });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    d.store.findSyndicationTargets = vi.fn().mockResolvedValue([target("a", "reddit"), target("a", "discord")]);
    const r = await crierTick(db, d);
    expect(r.failed).toBe(1);
    expect(r.posted).toBe(1);
    expect(d.store.recordFailure).toHaveBeenCalledWith(db, "a", "reddit", expect.stringContaining("RATELIMIT"));
    expect(d.store.recordSuccess).toHaveBeenCalledWith(db, "a", "discord", d.now);
  });
});
