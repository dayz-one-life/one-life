"use client";
import { useEffect, useState } from "react";
import { getVapidKey, subscribePush, unsubscribePush } from "@/lib/api";

type State = "unsupported" | "denied" | "off" | "on" | "working";

/** VAPID public keys are base64url; PushManager wants a Uint8Array. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function PushToggle() {
  const [state, setState] = useState<State>("working");

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    void navigator.serviceWorker.getRegistration().then(async (reg) => {
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    });
  }, []);

  async function enable() {
    setState("working");
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
      setState("off");
    }
  }

  async function disable() {
    setState("working");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await unsubscribePush(sub.endpoint);
        await sub.unsubscribe();
      }
    } finally {
      setState("off");
    }
  }

  const cls = "mt-1 text-left font-mono text-[10px] uppercase tracking-[.05em] text-ink-muted hover:text-red";
  if (state === "unsupported") return null;
  if (state === "denied") {
    return <p className={cls}>Push blocked in your browser settings.</p>;
  }
  if (state === "working") return <p className={cls}>Working…</p>;
  return (
    <button type="button" onClick={() => void (state === "on" ? disable() : enable())} className={cls}>
      {state === "on" ? "Turn off push alerts" : "Turn on push alerts"}
    </button>
  );
}
