"use client";
import { useCallback, useEffect, useState } from "react";
import { getPushStatus, getVapidKey, subscribePush, unsubscribePush } from "@/lib/api";
import { currentPushSubscription } from "@/lib/push";

type State = "unsupported" | "denied" | "off" | "on" | "working" | "error";

const ENABLE_FAILED = "Couldn't turn push alerts on. Try again.";
const DISABLE_FAILED = "Push alerts are STILL ON — we couldn't turn them off. Try again.";

/** VAPID public keys are base64url; PushManager wants a Uint8Array. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** `onDark` — this control renders inside NotificationsPanel, which sits on the light rail AND on
 *  the `bg-dark` mobile sheet. Without the swap its ink-muted styling is invisible on a phone,
 *  which is the device push notifications exist for. Mirrors NotificationsPanel's own prop. */
export function PushToggle({ onDark = false }: { onDark?: boolean }) {
  const [state, setState] = useState<State>("working");
  const [error, setError] = useState<string | null>(null);

  /** Browser state alone is not the truth. A PushSubscription object survives sign-out, an
   *  account switch on a shared machine, and the notifier retiring the row after repeated
   *  delivery failures — in all three the browser says "subscribed" while nothing will ever
   *  be delivered. So: ask the browser whether a subscription exists, then ask the server
   *  whether it is live *for this session user*. */
  const reconcile = useCallback(async () => {
    setState("working");
    setError(null);
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    const sub = await currentPushSubscription();
    if (!sub) {
      setState("off");
      return;
    }
    try {
      const { active } = await getPushStatus(sub.endpoint);
      setState(active ? "on" : "off");
    } catch {
      // Unreachable server: report off. That is the self-healing direction — the user clicks
      // "turn on", the subscribe upserts by endpoint, and the server row is repaired.
      setState("off");
    }
  }, []);

  useEffect(() => { void reconcile(); }, [reconcile]);

  async function enable() {
    setState("working");
    setError(null);
    try {
      // requestPermission MUST be inside the click handler's call stack — browsers
      // ignore (and some permanently block) prompts not tied to a user gesture.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      const { publicKey } = await getVapidKey();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await subscribePush({ endpoint: json.endpoint, keys: json.keys });
      setState("on");
    } catch {
      // Never fall back to "off": an unset VAPID_PUBLIC_KEY makes subscribe() throw on every
      // click forever, and a button that silently springs back tells the user nothing.
      setError(ENABLE_FAILED);
      setState("error");
    }
  }

  async function disable() {
    setState("working");
    setError(null);
    try {
      const sub = await currentPushSubscription();
      if (sub) {
        // Server first: if this rejects, sub.unsubscribe() must not run, because the row
        // would then outlive the only endpoint that can delete it.
        await unsubscribePush(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      // "off" here would be the one failure this UI cannot recover from: a user who believes
      // they turned push off, and is still being pushed to, never touches the control again.
      setError(DISABLE_FAILED);
      setState("error");
    }
  }

  const cls = `mt-1 text-left font-mono text-[10px] uppercase tracking-[.05em] hover:text-red ${onDark ? "text-cream-muted" : "text-ink-muted"}`;
  if (state === "unsupported") return null;
  if (state === "denied") {
    return <p className={cls}>Push blocked in your browser settings.</p>;
  }
  if (state === "working") return <p className={cls}>Working…</p>;
  if (state === "error") {
    return (
      <div className="mt-1 flex flex-col items-start gap-0.5">
        <p role="alert" className="font-mono text-[10px] uppercase tracking-[.05em] text-red">
          {error}
        </p>
        <button type="button" onClick={() => void reconcile()} className={cls}>
          Try again
        </button>
      </div>
    );
  }
  return (
    <button type="button" onClick={() => void (state === "on" ? disable() : enable())} className={cls}>
      {state === "on" ? "Turn off push alerts" : "Turn on push alerts"}
    </button>
  );
}
