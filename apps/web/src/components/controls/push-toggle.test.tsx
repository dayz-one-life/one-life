import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const getVapidKey = vi.fn();
const subscribePush = vi.fn();
const unsubscribePush = vi.fn();
const getPushStatus = vi.fn();
const currentPushSubscription = vi.fn();

vi.mock("@/lib/api", () => ({
  getVapidKey: () => getVapidKey(),
  subscribePush: (s: unknown) => subscribePush(s),
  unsubscribePush: (e: string) => unsubscribePush(e),
  getPushStatus: (e: string) => getPushStatus(e),
}));
vi.mock("@/lib/push", () => ({ currentPushSubscription: () => currentPushSubscription() }));

const { PushToggle } = await import("./push-toggle");

const ENDPOINT = "https://push.example/abc";
const browserUnsubscribe = vi.fn(async () => true);
const sub = () => ({
  endpoint: ENDPOINT,
  unsubscribe: browserUnsubscribe,
  toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: "p", auth: "a" } }),
});

const requestPermission = vi.fn(async () => "granted");
const pushSubscribe = vi.fn(async () => sub());

function stubBrowser(permission: NotificationPermission = "default") {
  vi.stubGlobal("Notification", { permission, requestPermission });
  vi.stubGlobal("PushManager", function PushManagerStub() {});
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true, writable: true,
    value: {
      register: vi.fn(async () => ({ pushManager: { subscribe: pushSubscribe } })),
      getRegistration: vi.fn(async () => ({ pushManager: { subscribe: pushSubscribe } })),
    },
  });
}

const onButton = () => screen.getByRole("button", { name: /turn on push alerts/i });
const offButton = () => screen.getByRole("button", { name: /turn off push alerts/i });

beforeEach(() => {
  vi.clearAllMocks();
  browserUnsubscribe.mockResolvedValue(true);
  requestPermission.mockResolvedValue("granted");
  pushSubscribe.mockImplementation(async () => sub());
  getVapidKey.mockResolvedValue({ publicKey: "QUJDRA" });
  subscribePush.mockResolvedValue({ ok: true });
  unsubscribePush.mockResolvedValue({ ok: true });
  getPushStatus.mockResolvedValue({ active: true });
  currentPushSubscription.mockResolvedValue(null);
  stubBrowser();
});

describe("PushToggle mount reconciliation", () => {
  it("offers to turn push on when nothing is subscribed", async () => {
    render(<PushToggle />);
    expect(await screen.findByRole("button", { name: /turn on push alerts/i })).toBeInTheDocument();
    expect(getPushStatus).not.toHaveBeenCalled();
  });

  it("shows push as on when browser and server agree", async () => {
    currentPushSubscription.mockResolvedValue(sub());
    render(<PushToggle />);
    expect(await screen.findByRole("button", { name: /turn off push alerts/i })).toBeInTheDocument();
    expect(getPushStatus).toHaveBeenCalledWith(ENDPOINT);
  });

  // The C2 case: the notifier retired the row after 5 failed deliveries, or a different user
  // is now signed in on this browser. The PushSubscription object is untouched either way, so
  // browser-only state claims "on" while no push can ever arrive.
  it("shows push as OFF when the server has no active subscription for this user", async () => {
    currentPushSubscription.mockResolvedValue(sub());
    getPushStatus.mockResolvedValue({ active: false });
    render(<PushToggle />);
    expect(await screen.findByRole("button", { name: /turn on push alerts/i })).toBeInTheDocument();
  });

  it("falls back to off when the status check fails, so the user can re-subscribe", async () => {
    currentPushSubscription.mockResolvedValue(sub());
    getPushStatus.mockRejectedValue(new Error("offline"));
    render(<PushToggle />);
    expect(await screen.findByRole("button", { name: /turn on push alerts/i })).toBeInTheDocument();
  });

  it("renders nothing when the browser cannot do push", async () => {
    // Absent, not undefined: the support check is `"serviceWorker" in navigator`, which a
    // defined-but-undefined property still satisfies.
    Reflect.deleteProperty(navigator, "serviceWorker");
    const { container } = render(<PushToggle />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("explains a browser-level block instead of offering a dead button", async () => {
    stubBrowser("denied");
    render(<PushToggle />);
    expect(await screen.findByText(/blocked in your browser/i)).toBeInTheDocument();
  });
});

describe("PushToggle enable", () => {
  it("registers, subscribes and reports on", async () => {
    render(<PushToggle />);
    fireEvent.click(await screen.findByRole("button", { name: /turn on push alerts/i }));
    await waitFor(() => expect(offButton()).toBeInTheDocument());
    expect(subscribePush).toHaveBeenCalledWith({ endpoint: ENDPOINT, keys: { p256dh: "p", auth: "a" } });
  });

  // The C4 case: VAPID_PUBLIC_KEY unset on the api unit => publicKey "" => subscribe() throws.
  // The old catch set "off", so the button silently flipped back with no message, forever.
  it("surfaces an error rather than silently flipping back to off", async () => {
    getVapidKey.mockResolvedValue({ publicKey: "" });
    pushSubscribe.mockRejectedValue(new Error("InvalidAccessError"));
    render(<PushToggle />);
    fireEvent.click(await screen.findByRole("button", { name: /turn on push alerts/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could ?n.t turn push alerts on/i);
    expect(screen.queryByRole("button", { name: /turn on push alerts/i })).toBeNull();
  });

  it("reports a denied permission prompt as denied, not as an error", async () => {
    requestPermission.mockResolvedValue("denied");
    render(<PushToggle />);
    fireEvent.click(await screen.findByRole("button", { name: /turn on push alerts/i }));
    expect(await screen.findByText(/blocked in your browser/i)).toBeInTheDocument();
  });
});

describe("PushToggle disable", () => {
  beforeEach(() => { currentPushSubscription.mockResolvedValue(sub()); });

  it("deletes the server row, drops the browser subscription and reports off", async () => {
    render(<PushToggle />);
    fireEvent.click(await screen.findByRole("button", { name: /turn off push alerts/i }));
    await waitFor(() => expect(onButton()).toBeInTheDocument());
    expect(unsubscribePush).toHaveBeenCalledWith(ENDPOINT);
    expect(browserUnsubscribe).toHaveBeenCalledOnce();
  });

  // The C3 case, and the direction that never self-heals: a user told "off" who is still
  // being pushed to will not touch the control again.
  it("never claims off when the server call failed", async () => {
    unsubscribePush.mockRejectedValue(new Error("500"));
    render(<PushToggle />);
    fireEvent.click(await screen.findByRole("button", { name: /turn off push alerts/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/still on/i);
    expect(screen.queryByRole("button", { name: /turn on push alerts/i })).toBeNull();
    expect(browserUnsubscribe).not.toHaveBeenCalled();
  });

  it("never claims off when the browser unsubscribe failed", async () => {
    browserUnsubscribe.mockRejectedValue(new Error("nope"));
    render(<PushToggle />);
    fireEvent.click(await screen.findByRole("button", { name: /turn off push alerts/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/still on/i);
  });

  it("lets the user retry from the error state", async () => {
    unsubscribePush.mockRejectedValueOnce(new Error("500"));
    render(<PushToggle />);
    fireEvent.click(await screen.findByRole("button", { name: /turn off push alerts/i }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(offButton()).toBeInTheDocument());
  });

  // This control lives INSIDE NotificationsPanel, so it inherits whichever surface the panel is
  // on — and the mobile ControlsSheet is bg-dark. Its ink-muted styling made it invisible there:
  // the one control that turns push on, unreadable on the device push exists for.
  describe("on a dark surface", () => {
    it("uses a sheet-legible token in every state", async () => {
      const { rerender } = render(<PushToggle onDark />);
      expect((await screen.findByRole("button", { name: /turn off push alerts/i })).className)
        .toContain("text-cream-muted");

      unsubscribePush.mockRejectedValueOnce(new Error("500"));
      fireEvent.click(screen.getByRole("button", { name: /turn off push alerts/i }));
      expect(await screen.findByRole("alert")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /try again/i }).className).toContain("text-cream-muted");

      rerender(<PushToggle onDark />);
      expect(screen.getByRole("button", { name: /try again/i }).className).not.toContain("text-ink-muted");
    });

    it("keeps the light rail default when onDark is absent", async () => {
      render(<PushToggle />);
      expect((await screen.findByRole("button", { name: /turn off push alerts/i })).className)
        .toContain("text-ink-muted");
    });
  });
});
