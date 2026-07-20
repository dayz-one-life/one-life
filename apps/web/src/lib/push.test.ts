import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const unsubscribePush = vi.fn(async (_endpoint: string) => ({ ok: true as const }));
const signOut = vi.fn(async () => {});
vi.mock("./api", () => ({ unsubscribePush: (e: string) => unsubscribePush(e) }));
vi.mock("./auth-client", () => ({ signOut: () => signOut() }));

const { currentPushSubscription, teardownPush, signOutAndTeardownPush } = await import("./push");

/** Order of every call made through the mocks, so "before" assertions are real. */
let order: string[] = [];
const subUnsubscribe = vi.fn(async () => { order.push("browser.unsubscribe"); return true; });
const getSubscription = vi.fn(async (): Promise<unknown> => ({
  endpoint: "https://push.example/abc",
  unsubscribe: subUnsubscribe,
}));

function stubServiceWorker(getRegistration = vi.fn(async () => ({ pushManager: { getSubscription } }))) {
  Object.defineProperty(navigator, "serviceWorker", {
    value: { getRegistration, register: vi.fn() }, configurable: true, writable: true,
  });
  return getRegistration;
}

beforeEach(() => {
  order = [];
  vi.clearAllMocks();
  unsubscribePush.mockImplementation(async () => { order.push("server.delete"); return { ok: true as const }; });
  signOut.mockImplementation(async () => { order.push("signOut"); });
  subUnsubscribe.mockImplementation(async () => { order.push("browser.unsubscribe"); return true; });
  getSubscription.mockImplementation(async () => ({
    endpoint: "https://push.example/abc", unsubscribe: subUnsubscribe,
  }));
  stubServiceWorker();
  Object.defineProperty(window, "location", { value: { href: "" }, configurable: true, writable: true });
});

afterEach(() => { vi.restoreAllMocks(); });

describe("currentPushSubscription", () => {
  it("returns null when the browser has no service worker support", async () => {
    Object.defineProperty(navigator, "serviceWorker", { value: undefined, configurable: true });
    expect(await currentPushSubscription()).toBeNull();
  });

  it("returns null when nothing is registered", async () => {
    stubServiceWorker(vi.fn(async () => undefined as never));
    expect(await currentPushSubscription()).toBeNull();
  });
});

describe("teardownPush", () => {
  it("deletes the server row before dropping the browser subscription", async () => {
    await teardownPush();
    expect(unsubscribePush).toHaveBeenCalledWith("https://push.example/abc");
    expect(order).toEqual(["server.delete", "browser.unsubscribe"]);
  });

  it("does not call the server when there is no subscription", async () => {
    getSubscription.mockImplementation(async () => null);
    await teardownPush();
    expect(unsubscribePush).not.toHaveBeenCalled();
  });

  it("never throws, so a caller can rely on it completing", async () => {
    unsubscribePush.mockRejectedValue(new Error("offline"));
    await expect(teardownPush()).resolves.toBeUndefined();
  });
});

describe("signOutAndTeardownPush", () => {
  // Ordering is load-bearing: DELETE /me/push-subscriptions is scoped to the session user,
  // so after signOut() it matches zero rows and the subscription outlives the session.
  it("deletes the subscription while the session is still valid, then signs out", async () => {
    await signOutAndTeardownPush();
    expect(order).toEqual(["server.delete", "browser.unsubscribe", "signOut"]);
  });

  // A shared machine is the whole point: user A's row must not survive into user B's session.
  it("signs out anyway when the push teardown fails", async () => {
    unsubscribePush.mockRejectedValue(new Error("500"));
    await signOutAndTeardownPush();
    expect(signOut).toHaveBeenCalledOnce();
    expect(window.location.href).toBe("/");
  });

  it("redirects even when signOut itself rejects", async () => {
    signOut.mockRejectedValue(new Error("network"));
    await signOutAndTeardownPush();
    expect(window.location.href).toBe("/");
  });
});
