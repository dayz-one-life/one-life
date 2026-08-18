import { describe, it, expect, vi } from "vitest";
import { buildFcmSender } from "../src/fcm-sender.js";
import type { ActiveSubscription } from "../src/push-store.js";

const device: ActiveSubscription = { kind: "device", id: 1, token: "tok", platform: "android" };
const web: ActiveSubscription = { kind: "webpush", id: 1, endpoint: "e", p256dh: "p", auth: "a" };
const payload = { title: "You died", body: "Mauled by a bear", href: "/p/bob", kind: "life_ended" };

const reply = (status: number, body = "") =>
  vi.fn(async () => new Response(body, { status }));

const sender = (fetchImpl: typeof globalThis.fetch) =>
  buildFcmSender({ projectId: "proj", getAccessToken: async () => "at", fetch: fetchImpl });

describe("buildFcmSender", () => {
  it("posts a v1 message to the project's send endpoint with a bearer token", async () => {
    const f = reply(200, "{}");
    expect(await sender(f as never)(device, payload)).toEqual({ ok: true });

    const [url, init] = (f as never as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe("https://fcm.googleapis.com/v1/projects/proj/messages:send");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer at");
    expect(JSON.parse(init.body as string)).toEqual({
      message: {
        token: "tok",
        notification: { title: "You died", body: "Mauled by a bear" },
        // The channel id is the whole reason `kind` is in the payload.
        android: { notification: { channel_id: "life_ended" } },
        data: { href: "/p/bob", kind: "life_ended" },
      },
    });
  });

  it("treats 404 as gone", async () => {
    const r = await sender(reply(404, "UNREGISTERED") as never)(device, payload);
    expect(r).toMatchObject({ ok: false, gone: true });
  });

  // ⚠️ These three must stay gone:false. 400 is also what FCM returns when OUR message shape is
  // wrong, and 403 is what it returns when FCM_PROJECT_ID is misconfigured. Mapping either to
  // gone means one bad deploy deletes every device token in the database.
  it.each([400, 403, 429, 500, 503])("treats %i as a retryable failure, not gone", async (status) => {
    const r = await sender(reply(status, "nope") as never)(device, payload);
    expect(r).toMatchObject({ ok: false, gone: false });
  });

  it("reports a thrown transport error as a retryable failure", async () => {
    const f = vi.fn(async () => { throw new Error("ECONNRESET"); });
    const r = await sender(f as never)(device, payload);
    expect(r).toMatchObject({ ok: false, gone: false });
    expect((r as { error: string }).error).toContain("ECONNRESET");
  });

  it("refuses a webpush subscription without calling FCM", async () => {
    const f = reply(200, "{}");
    const r = await sender(f as never)(web, payload);
    expect(r).toMatchObject({ ok: false, gone: false });
    expect(f).not.toHaveBeenCalled();
  });
});
