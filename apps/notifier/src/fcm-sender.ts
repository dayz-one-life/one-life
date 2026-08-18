import { GoogleAuth } from "google-auth-library";
import type { Sender } from "./sender.js";

const FCM_BASE = "https://fcm.googleapis.com/v1/projects";

type ErrorLog = { error: (obj: unknown, msg: string) => void };

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
  /** Optional so every existing call site and test keeps compiling unchanged. When given, a 400
   *  is logged at error level — see the module comment above for why 400 is special. */
  log?: ErrorLog;
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
      if (res.status === 400) {
        opts.log?.error(
          { status: res.status },
          "FCM rejected our message shape — our v1 message body is probably wrong, not the device token",
        );
      }
      return { ok: false, gone: res.status === 404, error: `fcm ${res.status}: ${body.slice(0, 300)}` };
    } catch (err) {
      return { ok: false, gone: false, error: String(err) };
    }
  };
}

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

/** Build an FCM sender, or null if credentials are missing or unusable.
 *
 *  Mirrors buildSender's contract exactly, and for the same reason: main.ts builds senders at
 *  MODULE SCOPE, so a throw here kills the process before the loop starts — taking notification
 *  generation down along with push, and failing the deploy script's post-start
 *  `systemctl is-active` check. Falling back to null keeps device push OFF and everything else
 *  running. */
export function buildFcmSenderFromConfig(
  cfg: { projectId: string; serviceAccountJsonBase64: string },
  log: ErrorLog,
): Sender | null {
  if (!cfg.projectId || !cfg.serviceAccountJsonBase64) return null;
  try {
    // Base64 because a service-account private key is a PEM full of newlines, which does not
    // survive a .env file intact. Buffer.from never throws on junk input — JSON.parse is what
    // catches a mangled value, which is exactly what we want it to do.
    const credentials = JSON.parse(
      Buffer.from(cfg.serviceAccountJsonBase64, "base64").toString("utf8"),
    ) as { client_email?: string; private_key?: string };
    if (!credentials.client_email || !credentials.private_key) {
      throw new Error("service account JSON has no client_email/private_key");
    }
    const auth = new GoogleAuth({ credentials, scopes: [FCM_SCOPE] });
    return buildFcmSender({
      projectId: cfg.projectId,
      // GoogleAuth caches the access token and refreshes it before expiry, so this is one
      // network round trip per hour, not one per notification.
      getAccessToken: async () => {
        const token = await auth.getAccessToken();
        if (!token) throw new Error("google-auth-library returned no access token");
        return token;
      },
      log,
    });
  } catch (err) {
    // Node embeds a prefix of the offending input in a JSON.parse error message. If an operator
    // base64s the private-key PEM alone instead of the whole JSON, logging `err` verbatim would
    // put a fragment of a private key in the logs. The message string below already carries the
    // actionable guidance, so only the error name is logged here.
    log.error(
      { err: err instanceof Error ? err.name : "unknown" },
      "invalid FCM configuration — device push is OFF (check FCM_PROJECT_ID and that FCM_SERVICE_ACCOUNT_JSON_BASE64 is the base64 of the whole service-account JSON); web push and generation continue",
    );
    return null;
  }
}
