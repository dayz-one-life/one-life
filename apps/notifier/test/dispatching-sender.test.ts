import { describe, it, expect, vi } from "vitest";
import { dispatchingSender } from "../src/sender.js";
import type { ActiveSubscription } from "../src/push-store.js";

const web: ActiveSubscription = { kind: "webpush", id: 1, endpoint: "e", p256dh: "p", auth: "a" };
const device: ActiveSubscription = { kind: "device", id: 1, token: "t", platform: "ios" };
const payload = { title: "t", body: "b", href: "/h", kind: "k" };

describe("dispatchingSender", () => {
  it("routes each subscription to its own transport", async () => {
    const w = vi.fn(async () => ({ ok: true as const }));
    const d = vi.fn(async () => ({ ok: true as const }));
    const send = dispatchingSender(w, d);
    await send(web, payload);
    await send(device, payload);
    expect(w).toHaveBeenCalledWith(web, payload);
    expect(d).toHaveBeenCalledWith(device, payload);
  });

  // gone:false matters — an unconfigured transport must never be read as a dead endpoint, or
  // deploying without FCM credentials would delete every device token instead of retrying.
  // configured:false matters too — it's what tells pushTick not to count this toward
  // MAX_FAILURES, since an unconfigured transport is not evidence about the endpoint's health.
  it("reports an unconfigured transport as a retryable failure, not as gone", async () => {
    const send = dispatchingSender(vi.fn(async () => ({ ok: true as const })), null);
    expect(await send(device, payload)).toEqual({
      ok: false, gone: false, error: "device push not configured", configured: false,
    });
  });

  it("reports an unconfigured web transport the same way", async () => {
    const send = dispatchingSender(null, vi.fn(async () => ({ ok: true as const })));
    expect(await send(web, payload)).toEqual({
      ok: false, gone: false, error: "web push not configured", configured: false,
    });
  });
});
