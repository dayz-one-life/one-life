import { describe, it, expect, vi } from "vitest";
import { buildFcmSender, buildFcmSenderFromConfig } from "../src/fcm-sender.js";
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

  // 400 nearly always means WE broke the message shape, not that the device is bad — that is
  // the one signal worth surfacing above ordinary retryable-failure noise (429s, 503s, ...).
  it("logs at error level on a 400, since that almost always means our message shape is wrong", async () => {
    const log = { error: vi.fn() };
    const s = buildFcmSender({ projectId: "proj", getAccessToken: async () => "at", fetch: reply(400, "bad") as never, log });
    await s(device, payload);
    expect(log.error).toHaveBeenCalledOnce();
    expect(log.error).toHaveBeenCalledWith({ status: 400 }, expect.stringContaining("message shape"));
  });

  it("does not log on a 503", async () => {
    const log = { error: vi.fn() };
    const s = buildFcmSender({ projectId: "proj", getAccessToken: async () => "at", fetch: reply(503, "down") as never, log });
    await s(device, payload);
    expect(log.error).not.toHaveBeenCalled();
  });
});

const log = { error: () => {} };
const CREDS = Buffer.from(JSON.stringify({
  type: "service_account", project_id: "proj", client_email: "svc@proj.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n",
})).toString("base64");

describe("buildFcmSenderFromConfig", () => {
  it("returns null when credentials are absent", () => {
    expect(buildFcmSenderFromConfig({ projectId: "", serviceAccountJsonBase64: "" }, log)).toBeNull();
    expect(buildFcmSenderFromConfig({ projectId: "proj", serviceAccountJsonBase64: "" }, log)).toBeNull();
    expect(buildFcmSenderFromConfig({ projectId: "", serviceAccountJsonBase64: CREDS }, log)).toBeNull();
  });

  // Same lesson as buildSender: a throw here is at module scope in main.ts, which kills the
  // process before the loop starts and takes notification GENERATION down with push.
  it("returns null rather than throwing on unparseable credentials", () => {
    expect(buildFcmSenderFromConfig(
      { projectId: "proj", serviceAccountJsonBase64: "!!!not-base64!!!" }, log,
    )).toBeNull();
  });

  it("returns a sender for well-formed credentials", () => {
    expect(buildFcmSenderFromConfig({ projectId: "proj", serviceAccountJsonBase64: CREDS }, log))
      .toBeTypeOf("function");
  });
});
