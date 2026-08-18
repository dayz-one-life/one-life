import type { Sender } from "./sender.js";

const FCM_BASE = "https://fcm.googleapis.com/v1/projects";

/** Send through FCM HTTP v1.
 *
 *  Chosen over Expo's push service specifically because FCM returns per-message errors
 *  SYNCHRONOUSLY, so a dead token maps straight onto the existing `{ ok: false, gone: true }`
 *  contract with no separate receipts sweep.
 *
 *  ⚠️ `gone` is HTTP 404 and NOTHING else. FCM also returns 400 INVALID_ARGUMENT when our own
 *  message shape is wrong and 403 SENDER_ID_MISMATCH when the project id is misconfigured.
 *  Mapping those to `gone` would let a single bad deploy silently delete every device token in
 *  the database, with reinstall as the only user recovery. A genuinely dead token instead
 *  retires itself after MAX_FAILURES ticks, which costs five requests and is always safe. */
export function buildFcmSender(opts: {
  projectId: string;
  getAccessToken: () => Promise<string>;
  fetch?: typeof globalThis.fetch;
}): Sender {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const url = `${FCM_BASE}/${opts.projectId}/messages:send`;

  return async (sub, payload) => {
    if (sub.kind !== "device") {
      return { ok: false, gone: false, error: "fcmSender received a webpush subscription" };
    }
    try {
      const accessToken = await opts.getAccessToken();
      const res = await doFetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          message: {
            token: sub.token,
            notification: { title: payload.title, body: payload.body },
            android: { notification: { channel_id: payload.kind } },
            data: { href: payload.href, kind: payload.kind },
          },
        }),
      });
      if (res.ok) return { ok: true };
      const body = await res.text();
      return { ok: false, gone: res.status === 404, error: `fcm ${res.status}: ${body.slice(0, 300)}` };
    } catch (err) {
      return { ok: false, gone: false, error: String(err) };
    }
  };
}
