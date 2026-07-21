import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { MobileAccount } from "./mobile-account";
import { useControls, useControlsActions } from "./use-controls";

vi.mock("./use-controls", () => ({ useControls: vi.fn(), useControlsActions: vi.fn() }));
vi.mock("@/lib/push", () => ({ signOutAndTeardownPush: vi.fn(async () => {}) }));
vi.mock("@/lib/auth-client", () => ({ signOut: vi.fn(async () => {}) }));

const mut = () => ({ mutate: vi.fn(), isPending: false, isError: false, isSuccess: false, error: null });
const base = {
  name: "Boots", provider: "discord", balance: 3, servers: [], standing: [],
  standingLoading: false, balanceLoading: false,
};
const verified = {
  ...base,
  status: {
    kind: "verified",
    link: { id: 1, gamertag: "BootsColdwater", status: "verified", verifiedAt: "2026-07-01T00:00:00Z", challenge: null },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  (useControlsActions as Mock).mockReturnValue({
    claim: mut(), cancel: mut(), send: mut(), refer: mut(), redeem: mut(),
  });
});

describe("MobileAccount", () => {
  test("renders nothing while auth is still resolving", () => {
    (useControls as Mock).mockReturnValue({ ...base, status: { kind: "loading" } });
    const { container } = render(<MobileAccount />);
    expect(container).toBeEmptyDOMElement();
  });

  test("signed out: a 'Sign in' link to /login in the masthead, no fixed-bottom pill", () => {
    (useControls as Mock).mockReturnValue({ ...base, status: { kind: "signedOut" } });
    render(<MobileAccount />);
    const link = screen.getByRole("link", { name: "Sign in" });
    expect(link).toHaveAttribute("href", "/login");
    // The retired SignInPill was `fixed inset-x-3.5 bottom-...` — assert that markup is gone.
    expect(link.className).not.toMatch(/\bfixed\b/);
    expect(document.querySelector(".fixed.inset-x-3\\.5")).toBeNull();
    expect(link.className).toContain("xl:hidden");
  });

  test("signed in: the masthead avatar trigger has dialog a11y wiring and opens the sheet on click", () => {
    (useControls as Mock).mockReturnValue(verified);
    render(<MobileAccount />);

    const trigger = screen.getByRole("button");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-controls", "controls-sheet");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger.className).toContain("xl:hidden");
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("no ControlsPillView/SignInPill markup renders in any state", () => {
    (useControls as Mock).mockReturnValue(verified);
    render(<MobileAccount />);
    // The old pill rendered a visible "Player controls" text label inside the button; the new
    // trigger is icon-only (accessible name only), so that visible text must not appear.
    expect(screen.queryByText("Player controls")).not.toBeInTheDocument();
    expect(document.querySelector(".fixed.inset-x-3\\.5")).toBeNull();
  });

  test("mounts the VerificationAnnouncer live region, wrapped xl:hidden, unconditionally for a signed-in user", () => {
    (useControls as Mock).mockReturnValue(verified);
    render(<MobileAccount />);
    const status = screen.getByRole("status");
    expect(status.closest(".xl\\:hidden")).not.toBeNull();
  });

  // Spec §4: "Focus restore moves from the pill to the masthead trigger" — `useModalBehavior`
  // restores focus to whatever had it when the sheet opened, which is now this button rather
  // than the retired pill. Reduced motion is stubbed so the close is synchronous (mirrors
  // sheet.test.tsx's "reduced motion closes instantly" case) instead of waiting on the 160ms
  // exit transition.
  test("closing the sheet restores focus to the masthead trigger, not document.body", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    );
    const user = userEvent.setup();
    (useControls as Mock).mockReturnValue(verified);
    render(<MobileAccount />);

    const trigger = screen.getByRole("button", { name: "Player controls" });
    await user.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close controls" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });
});
