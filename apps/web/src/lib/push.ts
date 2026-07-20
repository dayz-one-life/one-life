"use client";
import { unsubscribePush } from "./api";
import { signOut } from "./auth-client";

/** This browser's live PushSubscription, or null if push isn't supported, no service worker
 *  is registered, or nothing is subscribed. Never throws — callers treat it as "no push". */
export async function currentPushSubscription(): Promise<PushSubscription | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.serviceWorker) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    return (await reg?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/** Drop this browser's push subscription, server row first.
 *
 *  Ordering is load-bearing: `DELETE /me/push-subscriptions` is scoped to the session user,
 *  so it must run while that session is still valid. Called after signOut() it matches zero
 *  rows, the row survives, and the next person to use the machine receives the previous
 *  user's notifications — including obituary headlines carrying their gamertag.
 *
 *  Never throws. A failed teardown must not be able to trap someone in a session. */
export async function teardownPush(): Promise<void> {
  try {
    const sub = await currentPushSubscription();
    if (!sub) return;
    await unsubscribePush(sub.endpoint);
    await sub.unsubscribe();
  } catch {
    // Swallowed deliberately — see above. The row is left behind, but the server-side
    // subscription is per-endpoint, so re-subscribing as the new user reclaims it.
  }
}

/** The one sign-out path for the whole app. Both the desktop rail and the mobile sheet call
 *  this, so the teardown can't drift between two copies of the same handler. */
export async function signOutAndTeardownPush(): Promise<void> {
  await teardownPush();
  try {
    await signOut();
  } catch {
    // The redirect happens regardless: the previous `void signOut().finally(…)` call sites
    // surfaced a failure only as an unhandled rejection, which helped nobody.
  } finally {
    window.location.href = "/";
  }
}
