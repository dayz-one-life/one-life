import { describe, it, expect, vi } from "vitest";
import { pushTick } from "../src/push.js";
import type { ActiveSubscription, UnpushedNotification } from "../src/push-store.js";
import type { Sender } from "../src/sender.js";

const NOW = new Date("2026-07-19T12:00:00Z");
const log = { info: () => {}, warn: () => {} };
const db = {} as never;

const note = (id: number, createdAt = new Date("2026-07-19T11:59:00Z")): UnpushedNotification => ({
  id, userId: "u1", kind: "k", title: "t", body: "b", href: "/h", createdAt,
});
const sub = (id: number): ActiveSubscription =>
  ({ kind: "webpush", id, endpoint: `e${id}`, p256dh: "p", auth: "a" });
const deviceSub = (id: number): ActiveSubscription =>
  ({ kind: "device", id, token: `t${id}`, platform: "android" });

function makeStore(over: Partial<Record<string, unknown>> = {}) {
  return {
    findUnpushed: vi.fn(async () => [note(1)]),
    activeSubscriptionsFor: vi.fn(async () => [sub(10)]),
    markPushed: vi.fn(async () => {}),
    deleteSubscription: vi.fn(async () => {}),
    recordFailure: vi.fn(async () => {}),
    ...over,
  } as never;
}

const base = { now: NOW, maxPerTick: 50, maxAgeMinutes: 60, enabled: true, dryRun: false, log };

describe("pushTick", () => {
  it("is a no-op when disabled", async () => {
    const store = makeStore();
    const r = await pushTick(db, { ...base, enabled: false, store, send: vi.fn() });
    expect(r.disabled).toBe(true);
    expect((store as never as { findUnpushed: { mock: unknown[] } }).findUnpushed).not.toHaveBeenCalled();
  });

  it("sends and stamps only after a confirmed send", async () => {
    const store = makeStore();
    const send = vi.fn(async () => ({ ok: true as const }));
    const r = await pushTick(db, { ...base, store, send });
    expect(r.sent).toBe(1);
    expect(send).toHaveBeenCalledOnce();
    expect((store as never as { markPushed: unknown }).markPushed).toHaveBeenCalledWith(db, 1, NOW);
  });

  it("stamps notifications for a user with no subscriptions so the sweep drains", async () => {
    const store = makeStore({ activeSubscriptionsFor: vi.fn(async () => []) });
    const send = vi.fn();
    const r = await pushTick(db, { ...base, store, send });
    expect(r.skipped).toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect((store as never as { markPushed: unknown }).markPushed).toHaveBeenCalledWith(db, 1, NOW);
  });

  it("stamps without sending when the notification is stale", async () => {
    const store = makeStore({ findUnpushed: vi.fn(async () => [note(1, new Date("2026-07-19T09:00:00Z"))]) });
    const send = vi.fn();
    const r = await pushTick(db, { ...base, store, send });
    expect(r.skipped).toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect((store as never as { markPushed: unknown }).markPushed).toHaveBeenCalledWith(db, 1, NOW);
  });

  it("deletes a subscription on a gone response", async () => {
    const store = makeStore();
    const send = vi.fn(async () => ({ ok: false as const, gone: true, error: "410" }));
    const r = await pushTick(db, { ...base, store, send });
    expect((store as never as { deleteSubscription: unknown }).deleteSubscription).toHaveBeenCalledWith(db, sub(10));
    expect(r.failed).toBe(1);
    expect((store as never as { markPushed: unknown }).markPushed).not.toHaveBeenCalled();
  });

  it("records a failure on a non-gone error and leaves the row unpushed", async () => {
    const store = makeStore();
    const send = vi.fn(async () => ({ ok: false as const, gone: false, error: "500" }));
    await pushTick(db, { ...base, store, send });
    expect((store as never as { recordFailure: unknown }).recordFailure).toHaveBeenCalledWith(db, sub(10), NOW);
    expect((store as never as { markPushed: unknown }).markPushed).not.toHaveBeenCalled();
  });

  it("stamps the row once at least one of two subscriptions accepts, while recording the other's failure", async () => {
    const store = makeStore({ activeSubscriptionsFor: vi.fn(async () => [sub(10), sub(11)]) });
    const send = vi.fn()
      .mockResolvedValueOnce({ ok: true as const })
      .mockResolvedValueOnce({ ok: false as const, gone: false, error: "500" });
    const r = await pushTick(db, { ...base, store, send });
    expect(r.sent).toBe(1);
    expect(r.failed).toBe(1);
    expect((store as never as { markPushed: unknown }).markPushed).toHaveBeenCalledWith(db, 1, NOW);
    expect((store as never as { recordFailure: unknown }).recordFailure).toHaveBeenCalledWith(db, sub(11), NOW);
  });

  it("does not send in dry run", async () => {
    const store = makeStore();
    const send = vi.fn();
    await pushTick(db, { ...base, dryRun: true, store, send });
    expect(send).not.toHaveBeenCalled();
    expect((store as never as { markPushed: unknown }).markPushed).not.toHaveBeenCalled();
  });

  it("delivers to a browser and a phone, and stamps when only one accepts", async () => {
    const store = makeStore({ activeSubscriptionsFor: vi.fn(async () => [sub(10), deviceSub(10)]) });
    const send = vi.fn(async (s: ActiveSubscription) =>
      s.kind === "webpush" ? { ok: true as const } : { ok: false as const, gone: false, error: "boom" });
    const r = await pushTick(db, { ...base, store, send });
    expect(send).toHaveBeenCalledTimes(2);
    expect(r.sent).toBe(1);
    expect(r.failed).toBe(1);
    // Passing the whole subscription, not a loose id, is what lets the store target the right table.
    expect((store as never as { recordFailure: { mock: { calls: unknown[][] } } }).recordFailure.mock.calls[0]![1])
      .toMatchObject({ kind: "device", id: 10 });
  });

  it("does not record a failure or mark pushed when the transport is unconfigured", async () => {
    const store = makeStore();
    const send = vi.fn(async () => (
      { ok: false as const, gone: false, error: "device push not configured", configured: false as const }
    ));
    const r = await pushTick(db, { ...base, store, send });
    expect(r.failed).toBe(1);
    expect((store as never as { recordFailure: unknown }).recordFailure).not.toHaveBeenCalled();
    expect((store as never as { deleteSubscription: unknown }).deleteSubscription).not.toHaveBeenCalled();
    expect((store as never as { markPushed: unknown }).markPushed).not.toHaveBeenCalled();
  });

  it("hands the sender a payload object carrying the notification kind", async () => {
    const store = makeStore();
    const send: Sender = vi.fn(async () => ({ ok: true as const }));
    await pushTick(db, { ...base, store, send });
    expect(vi.mocked(send).mock.calls[0]![1]).toEqual({ title: "t", body: "b", href: "/h", kind: "k" });
  });
});
