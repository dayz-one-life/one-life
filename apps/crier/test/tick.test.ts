import { describe, it, expect, vi } from "vitest";
import { crierTick, type CrierDeps } from "../src/tick.js";
import type { Config } from "../src/config.js";

const cfg = (over: Partial<Config> = {}): Config => ({
  databaseUrl: "x", siteUrl: "https://dayzonelife.com", intervalSeconds: 60,
  since: new Date("2026-07-31T00:00:00Z"), dryRun: false, batchCap: 10, maxAttempts: 5,
  discordWebhookUrl: "https://discord.test/hook",
  fbPageId: "990", fbPageAccessToken: "tok",
  x: null,
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
    expect(r).toEqual({ posted: 0, failed: 0, skipped: 0, dryRun: false });
    expect(d.store.findSyndicationTargets).not.toHaveBeenCalled();
  });

  it("does nothing when no channel is configured", async () => {
    const d = deps({ cfg: cfg({ discordWebhookUrl: null, fbPageId: null, fbPageAccessToken: null }) });
    await crierTick(db, d);
    expect(d.store.findSyndicationTargets).not.toHaveBeenCalled();
  });

  it("dry-run: logs targets, makes zero external calls and zero writes", async () => {
    const d = deps({ cfg: cfg({ dryRun: true }) });
    d.store.findSyndicationTargets = vi.fn().mockResolvedValue([target("a", "discord"), target("a", "facebook")]);
    const r = await crierTick(db, d);
    expect(r).toEqual({ posted: 0, failed: 0, skipped: 2, dryRun: true });
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
