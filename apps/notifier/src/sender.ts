import webpush from "web-push";
import type { ActiveSubscription } from "./push-store.js";

export type SendResult = { ok: true } | { ok: false; gone: boolean; error: string };
export type Sender = (sub: ActiveSubscription, payload: string) => Promise<SendResult>;

/** Build a web-push sender. A 404/410 means the browser discarded the subscription —
 *  that endpoint is permanently dead and its row should be deleted, not retried. */
export function webPushSender(vapid: { publicKey: string; privateKey: string; subject: string }): Sender {
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  return async (sub, payload) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      );
      return { ok: true };
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      return { ok: false, gone: status === 404 || status === 410, error: String(err) };
    }
  };
}

type ErrorLog = { error: (obj: unknown, msg: string) => void };

/** Build a sender, or null if VAPID is missing or invalid.
 *
 *  webpush.setVapidDetails() throws SYNCHRONOUSLY on a subject without its mailto:/https:
 *  prefix or on a truncated/malformed key. Unguarded at module scope that kills the process
 *  before the loop starts — taking generation down with push, and failing the deploy script's
 *  post-start `systemctl is-active` check. Falling back to null keeps push OFF and generation
 *  running, the same isolation the tick-level try/catch provides. */
export function buildSender(
  vapid: { publicKey: string; privateKey: string; subject: string },
  log: ErrorLog,
): Sender | null {
  if (!vapid.publicKey || !vapid.privateKey || !vapid.subject) return null;
  try {
    return webPushSender(vapid);
  } catch (err) {
    log.error(
      { err },
      "invalid VAPID configuration — push is OFF (check VAPID_SUBJECT has a mailto: prefix and that the keys are complete); generation continues",
    );
    return null;
  }
}
