import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { MobileAccount } from "./mobile-account";
import { useControls, useControlsActions } from "./use-controls";
import { signOutAndTeardownPush } from "@/lib/push";

vi.mock("./use-controls", () => ({ useControls: vi.fn(), useControlsActions: vi.fn() }));
vi.mock("@/lib/push", () => ({ signOutAndTeardownPush: vi.fn(async () => {}) }));
vi.mock("@/lib/auth-client", () => ({ signOut: vi.fn(async () => {}) }));
// FriendsPanelContainer reads useFriends directly (unlike the other sheet panels, which are
// props-only and driven by useControls) — stub it so this file's plain useControls mock
// doesn't have to also satisfy useFriends' own useSession/useGamertagLinks chain.
vi.mock("@/lib/use-friends", () => ({ useFriends: () => ({ data: null, loading: false, error: false }) }));

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
const pending = {
  ...base,
  status: {
    kind: "pending",
    link: {
      id: 1, gamertag: "BootsColdwater", status: "pending", verifiedAt: null,
      challenge: { sequence: ["facepalm", "salute", "clap"], progressIndex: 1, expiresAt: "2026-07-17T00:00:00Z", expired: false },
    },
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

  test("no ControlsPillView/SignInPill markup renders in any signed-in state", () => {
    for (const status of [verified, pending, { ...base, status: { kind: "unlinked" } }, { ...base, status: { kind: "signedOut" } }]) {
      (useControls as Mock).mockReturnValue(status);
      const { unmount } = render(<MobileAccount />);
      // The old pill rendered a visible "Player controls" text label inside the button; the new
      // trigger is icon-only (accessible name only), so that visible text must not appear.
      expect(screen.queryByText("Player controls")).not.toBeInTheDocument();
      expect(document.querySelector(".fixed.inset-x-3\\.5")).toBeNull();
      unmount();
    }
  });

  // Regression pin (final-review Critical fix): the masthead's right-cluster wrapper
  // (`header.tsx`) carries `-translate-y-1/2` / `md:translate-y-0`, both non-`none` transforms
  // that make the wrapper a containing block for `position: fixed` descendants — an un-portaled
  // `ControlsSheet` collapses its `fixed inset-0` sheet + backdrop into that ~76x40px cluster box
  // instead of the viewport. Render MobileAccount inside a `<header>` standing in for that
  // cluster and assert the open dialog is portaled straight to document.body, not nested under
  // it — this is testable in jsdom (which computes no transforms) because it pins DOM structure,
  // not layout.
  test("portals the sheet to document.body, not nested under a masthead/header ancestor", async () => {
    const user = userEvent.setup();
    (useControls as Mock).mockReturnValue(verified);
    const { container } = render(
      <header>
        <MobileAccount />
      </header>,
    );

    await user.click(screen.getByRole("button", { name: "Player controls" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.closest("header")).toBeNull();
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.parentElement?.parentElement).toBe(document.body);
  });

  test("mounts the VerificationAnnouncer live region, wrapped xl:hidden, unconditionally for a signed-in user", () => {
    (useControls as Mock).mockReturnValue(verified);
    render(<MobileAccount />);
    const status = screen.getByRole("status");
    expect(status.closest(".xl\\:hidden")).not.toBeNull();
  });

  // Carryover pin (SP2), moved from the retired mobile-controls.test.tsx: `VerificationAnnouncer`
  // must survive the pending -> verified swap through the NEW trigger's tree (ProveItPanel/
  // TokensPanel unmount each other across that transition) and announce exactly once, never
  // re-firing on a later render while still verified.
  test("VerificationAnnouncer fires once on pending -> verified and does not double-announce", () => {
    (useControls as Mock).mockReturnValue(pending);
    const { rerender } = render(<MobileAccount />);
    expect(screen.getByRole("status")).toHaveTextContent("");

    (useControls as Mock).mockReturnValue(verified);
    rerender(<MobileAccount />);
    expect(screen.getByRole("status")).toHaveTextContent("Verification complete");

    // A later render while still verified must not re-announce or duplicate the live region.
    rerender(<MobileAccount />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Verification complete");
  });

  // Carryover pin (SP2 invariant #7), moved from the retired mobile-controls.test.tsx: the
  // sheet's sign-out control must go through `signOutAndTeardownPush` (deletes the push
  // subscription row before ending the session), never a bare `signOut()` — otherwise a shared
  // device keeps delivering the previous user's push notifications after sign-out.
  test("sign-out control in the sheet calls signOutAndTeardownPush before ending the session", async () => {
    const user = userEvent.setup();
    (useControls as Mock).mockReturnValue(verified);
    render(<MobileAccount />);

    await user.click(screen.getByRole("button", { name: "Player controls" }));
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(signOutAndTeardownPush).toHaveBeenCalledOnce();
  });

  // Carryover pin (SP3 live-data honesty), moved from the retired mobile-controls.test.tsx: the
  // sheet's standing-loading skeleton must not fabricate idle server rows, and must carry the
  // sheet's dark-surface tokens (two-surface rule, CLAUDE.md) — never a light `bg-bone`/`bg-paper`
  // token that would render present-in-the-DOM but invisible on the dark sheet.
  test("sheet: standing-unresolved shows a dark-token loading placeholder, not fabricated idle rows", async () => {
    const user = userEvent.setup();
    (useControls as Mock).mockReturnValue({
      ...verified,
      servers: [{ id: 1, nitradoServiceId: 1, name: "s", map: "chernarusplus", slug: "chernarus", active: true, clockOffsetMs: 0, createdAt: "2026-01-01T00:00:00Z" }],
      standingLoading: true,
    });
    render(<MobileAccount />);
    await user.click(screen.getByRole("button", { name: "Player controls" }));

    const dialog = screen.getByRole("dialog");
    const skeleton = dialog.querySelector('[aria-busy="true"]');
    expect(skeleton).toBeInTheDocument();
    const rows = skeleton!.querySelectorAll('[aria-hidden]');
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((row) => {
      expect(row.className).toContain("bg-dark-well");
      expect(row.className).not.toContain("bg-bone");
      expect(row.className).not.toContain("bg-paper");
    });
  });

  // Carryover pin (SP3 live-data honesty), moved from the retired mobile-controls.test.tsx: with
  // the tokens balance unresolved, TokensPanel's balance readout AND a banned server's SheetUnban
  // CTA must both show a dark-token "checking" affordance rather than a fabricated 0 balance or
  // a false "No unban tokens" claim.
  test("sheet: balance-unresolved shows dark-token TokensPanel/SheetUnban loading affordances, never a fabricated balance", async () => {
    const user = userEvent.setup();
    (useControls as Mock).mockReturnValue({
      ...verified,
      servers: [{ id: 2, nitradoServiceId: 2, name: "s", map: "sakhal", slug: "sakhal", active: true, clockOffsetMs: 0, createdAt: "2026-01-01T00:00:00Z" }],
      standing: [{
        serverId: 2, map: "sakhal", slug: "sakhal", state: "banned", character: null, alive: null,
        ban: { banId: 9, bannedAt: "2026-07-16T09:47:00Z", expiresAt: null, liftPending: false, triggeringLifeNumber: 1 },
      }],
      standingLoading: false,
      balance: null,
      balanceLoading: true,
    });
    render(<MobileAccount />);
    await user.click(screen.getByRole("button", { name: "Player controls" }));

    // TokensPanel: a dark-token loading chip, not a fabricated "0".
    const balanceChip = document.querySelector('[aria-busy="true"].bg-dark-well');
    expect(balanceChip).toBeInTheDocument();
    expect(screen.getByText(/checking your balance/i)).toBeInTheDocument();

    // SheetUnban: balance unresolved on a banned server -> the dark-token "checking" line, never
    // the false "No unban tokens" claim.
    expect(screen.queryByText("No unban tokens")).not.toBeInTheDocument();
    const tokensLoading = screen.getByText(/checking your tokens/i);
    expect(tokensLoading.className).toContain("border-dark-edge");
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
