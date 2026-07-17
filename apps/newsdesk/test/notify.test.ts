import { describe, it, expect } from "vitest";
import { notifyDiscord, type NotifyDeps } from "../src/notify.js";
import type { UnpostedObituary } from "../src/pg-store.js";
import type { DiscordPostResult } from "../src/discord.js";

const FAKE_DB = {} as any; // fake store ignores db

function row(id: number, slug: string): UnpostedObituary {
  return { id, slug, headline: "H", gamertag: "Tag" };
}

function makeDeps(over: Partial<NotifyDeps> & { rows?: UnpostedObituary[]; postResults?: DiscordPostResult[] }) {
  const marked: number[] = [];
  const logs: { level: string; obj: unknown; msg?: string }[] = [];
  const seenLimits: number[] = [];
  let postCalls = 0;
  const results = over.postResults ?? [];
  const deps: NotifyDeps = {
    webhookUrl: over.webhookUrl ?? "https://hook",
    siteUrl: over.siteUrl ?? "https://site",
    maxPerTick: over.maxPerTick ?? 10,
    dryRun: over.dryRun ?? false,
    now: over.now ?? new Date("2026-07-17T00:00:00Z"),
    log: {
      info: (obj, msg) => logs.push({ level: "info", obj, msg }),
      warn: (obj, msg) => logs.push({ level: "warn", obj, msg }),
    },
    store: {
      findUnpostedObituaries: async (_db, opts) => {
        seenLimits.push(opts.limit);
        return (over.rows ?? []).slice(0, opts.limit);
      },
      markObituaryPosted: async (_db, id) => {
        marked.push(id);
      },
    },
    post: async () => results[postCalls++] ?? { ok: true },
  };
  return { deps, marked, logs, seenLimits, getPostCalls: () => postCalls };
}

describe("notifyDiscord", () => {
  it("is a no-op when the webhook URL is empty", async () => {
    const { deps, getPostCalls } = makeDeps({ webhookUrl: "", rows: [row(1, "a")] });
    const res = await notifyDiscord(FAKE_DB, deps);
    expect(res).toEqual({ posted: 0, failed: 0, disabled: true });
    expect(getPostCalls()).toBe(0);
  });

  it("dry-run logs but does not post or stamp", async () => {
    const { deps, marked, logs, getPostCalls } = makeDeps({ dryRun: true, rows: [row(1, "a")] });
    const res = await notifyDiscord(FAKE_DB, deps);
    expect(res).toEqual({ posted: 0, failed: 0, disabled: false });
    expect(getPostCalls()).toBe(0);
    expect(marked).toEqual([]);
    expect(logs.some((l) => String(l.msg).includes("DRY RUN"))).toBe(true);
  });

  it("posts and stamps on success", async () => {
    const { deps, marked } = makeDeps({ rows: [row(1, "a"), row(2, "b")], postResults: [{ ok: true }, { ok: true }] });
    const res = await notifyDiscord(FAKE_DB, deps);
    expect(res).toEqual({ posted: 2, failed: 0, disabled: false });
    expect(marked).toEqual([1, 2]);
  });

  it("counts a failure and leaves the row unstamped, continuing", async () => {
    const { deps, marked } = makeDeps({
      rows: [row(1, "a"), row(2, "b")],
      postResults: [{ ok: false, rateLimited: false, error: "boom" }, { ok: true }],
    });
    const res = await notifyDiscord(FAKE_DB, deps);
    expect(res).toEqual({ posted: 1, failed: 1, disabled: false });
    expect(marked).toEqual([2]);
  });

  it("passes maxPerTick as the store limit", async () => {
    const { deps, seenLimits } = makeDeps({ maxPerTick: 3, rows: [] });
    await notifyDiscord(FAKE_DB, deps);
    expect(seenLimits).toEqual([3]);
  });

  it("stops posting on a 429 and does not touch remaining rows", async () => {
    const { deps, marked, getPostCalls } = makeDeps({
      rows: [row(1, "a"), row(2, "b")],
      postResults: [{ ok: false, rateLimited: true, retryAfterSeconds: 2 }],
    });
    const res = await notifyDiscord(FAKE_DB, deps);
    expect(res).toEqual({ posted: 0, failed: 0, disabled: false });
    expect(getPostCalls()).toBe(1); // stopped after the first row
    expect(marked).toEqual([]);
  });
});
