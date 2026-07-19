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
