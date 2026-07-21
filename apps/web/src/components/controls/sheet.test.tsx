import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { ControlsSheet, SheetServerRow } from "./sheet";
import type { ServerCardData } from "./format";

const mockPathname = vi.fn(() => "/");
vi.mock("next/navigation", () => ({ usePathname: () => mockPathname() }));

function matchMediaStub(reduce: boolean) {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: reduce, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

beforeEach(() => {
  vi.useRealTimers();
  mockPathname.mockReturnValue("/");
  matchMediaStub(false);
});

const sheet = (open: boolean, onClose = vi.fn()) => (
  <ControlsSheet open={open} onClose={onClose} header={<span>Boots</span>}>
    <p>Body</p>
  </ControlsSheet>
);

describe("ControlsSheet", () => {
  test("closed renders nothing; open renders the dialog with a drag zone", () => {
    const { rerender } = render(sheet(false));
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(sheet(true));
    const dialog = screen.getByRole("dialog", { name: "Player controls" });
    expect(dialog.querySelector("[data-sheet-drag-zone]")).not.toBeNull();
  });

  test("two-phase close: DOM survives closing, unmounts after the exit", () => {
    vi.useFakeTimers();
    const { rerender } = render(sheet(true));
    rerender(sheet(false));
    // Still mounted during the exit phase…
    expect(screen.getByRole("dialog")).toHaveClass("translate-y-full");
    // …gone after the safety timeout.
    act(() => void vi.advanceTimersByTime(500));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("reduced motion closes instantly", () => {
    matchMediaStub(true);
    const { rerender } = render(sheet(true));
    rerender(sheet(false));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("route change closes the sheet", () => {
    const onClose = vi.fn();
    const { rerender } = render(sheet(true, onClose));
    mockPathname.mockReturnValue("/players/boots");
    rerender(sheet(true, onClose));
    expect(onClose).toHaveBeenCalled();
  });

  test("scrim click and × still close", () => {
    const onClose = vi.fn();
    const { container } = render(sheet(true, onClose));
    fireEvent.click(container.querySelector(".bg-dark\\/55")!);
    fireEvent.click(screen.getByRole("button", { name: "Close controls" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test("safe-area padding and dvh cap are present", () => {
    render(sheet(true));
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("max-h-[85dvh]");
    expect(dialog.innerHTML).toContain("safe-area-inset-bottom");
  });

  test("reopening during the exit resurrects the sheet", () => {
    vi.useFakeTimers();
    const { rerender } = render(sheet(true));
    rerender(sheet(false)); // exit starts
    rerender(sheet(true)); // …user reopens mid-exit
    act(() => void vi.advanceTimersByTime(500));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

const bannedCard: ServerCardData = {
  slug: "chernarus",
  map: "chernarusplus",
  state: "banned",
  lifeNumber: 7,
  alive: null,
  ban: { banId: 1, bannedAt: "2026-07-16T10:00:00Z", expiresAt: "2026-07-17T10:00:00Z", liftPending: true },
};

describe("SheetServerRow", () => {
  // Positive control for the live-countdown branch: standing-card/server-cards tests both pin
  // this render (a FUTURE expiresAt renders "Ban lifts in" + the formatted remainder), but this
  // file only ever exercised the terminal (past-expiry) and pending/loading branches — the live
  // countdown itself was unpinned here.
  test("future expiry: live countdown renders 'Ban lifts in' + the formatted remainder", () => {
    render(
      <SheetServerRow card={bannedCard} ownSlug={null} balance={1} now={new Date("2026-07-16T12:00:00Z")} onRedeem={() => {}} redeeming={false} />,
    );
    expect(screen.getByText("Ban lifts in")).toBeInTheDocument();
    expect(screen.getByText("22h 0m")).toBeInTheDocument();
  });

  test("past expiry: terminal Lifting state on dark tokens, no dead 0h 0m timer", () => {
    const expiredCard: ServerCardData = { ...bannedCard, ban: { ...bannedCard.ban!, expiresAt: "2026-07-16T10:00:00Z", liftPending: false } };
    render(
      <SheetServerRow card={expiredCard} ownSlug={null} balance={1} now={new Date("2026-07-16T12:00:00Z")} onRedeem={() => {}} redeeming={false} />,
    );
    const lifting = screen.getByText("Lifting…");
    expect(lifting).toBeInTheDocument();
    expect(lifting.className).toContain("text-cream-muted");
    expect(screen.queryByText(/0h 0m/)).not.toBeInTheDocument();
    expect(screen.queryByText("Ban lifts in")).not.toBeInTheDocument();
  });

  test("a pending self-unban is announced via a role=status region (the sheet's own copy)", () => {
    render(
      <SheetServerRow card={bannedCard} ownSlug={null} balance={1} now={new Date("2026-07-16T12:00:00Z")} onRedeem={() => {}} redeeming={false} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Unban pending — lifting shortly…");
  });

  test("the status region pre-exists the ready state and announces on the ready -> pending transition", () => {
    const readyCard: ServerCardData = { ...bannedCard, ban: { ...bannedCard.ban!, liftPending: false } };
    const { rerender } = render(
      <SheetServerRow card={readyCard} ownSlug={null} balance={1} now={new Date("2026-07-16T12:00:00Z")} onRedeem={() => {}} redeeming={false} />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("");
    rerender(
      <SheetServerRow card={readyCard} ownSlug={null} balance={1} now={new Date("2026-07-16T12:00:00Z")} onRedeem={() => {}} redeeming />,
    );
    // Same node — the live region was already in the DOM before its text changed.
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toHaveTextContent("Unban pending — lifting shortly…");
  });

  // live-data honesty §5 fix round 1: mirrors the ServerCard (light-surface) fix — the dark
  // sheet's row must not assert "No unban tokens" before the tokens query settles.
  test("balance unresolved: checking placeholder, never a fabricated no-tokens CTA", () => {
    const readyCard: ServerCardData = { ...bannedCard, ban: { ...bannedCard.ban!, liftPending: false } };
    render(
      <SheetServerRow card={readyCard} ownSlug={null} balance={0} balanceLoading now={new Date("2026-07-16T12:00:00Z")} onRedeem={() => {}} redeeming={false} />,
    );
    expect(screen.queryByText("No unban tokens")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /spend 1 token/i })).not.toBeInTheDocument();
    expect(screen.getByText(/checking your tokens/i)).toBeInTheDocument();
  });

  // Regression pin (two-surface token rule, CLAUDE.md): the sheet is the DARK surface —
  // SheetUnban's "Checking your tokens…" placeholder must carry on-dark tokens
  // (`border-dark-edge`/`text-cream-muted`), never a light/ink-on-dark token like `text-ink` or
  // `border-dash`, which would render present-in-the-DOM but invisible against `bg-dark`.
  test("balance unresolved: the checking placeholder carries dark-surface tokens, not light ones", () => {
    const readyCard: ServerCardData = { ...bannedCard, ban: { ...bannedCard.ban!, liftPending: false } };
    render(
      <SheetServerRow card={readyCard} ownSlug={null} balance={0} balanceLoading now={new Date("2026-07-16T12:00:00Z")} onRedeem={() => {}} redeeming={false} />,
    );
    const placeholder = screen.getByText(/checking your tokens/i);
    // Exact-token match (not substring) — `border-dashed` legitimately contains the substring
    // `border-dash`, the distinct LIGHT-surface token this assertion exists to rule out.
    const classes = placeholder.className.split(/\s+/);
    expect(classes).toContain("border-dark-edge");
    expect(classes).toContain("text-cream-muted");
    expect(classes).not.toContain("text-ink");
    expect(classes).not.toContain("border-dash");
  });

  test("balance resolved to a real zero: still shows the no-tokens notice", () => {
    const readyCard: ServerCardData = { ...bannedCard, ban: { ...bannedCard.ban!, liftPending: false } };
    render(
      <SheetServerRow card={readyCard} ownSlug={null} balance={0} balanceLoading={false} now={new Date("2026-07-16T12:00:00Z")} onRedeem={() => {}} redeeming={false} />,
    );
    expect(screen.getByText("No unban tokens")).toBeInTheDocument();
  });

  test("lift-already-pending wins even while the balance is unresolved", () => {
    render(
      <SheetServerRow card={bannedCard} ownSlug={null} balance={0} balanceLoading now={new Date("2026-07-16T12:00:00Z")} onRedeem={() => {}} redeeming={false} />,
    );
    expect(screen.queryByText(/checking your tokens/i)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Unban pending — lifting shortly…");
  });

  test("links to the life timeline with ON-DARK tokens, not the light-surface red", () => {
    const card: ServerCardData = { ...bannedCard, lifeNumber: 7 };
    render(<SheetServerRow card={card} ownSlug="dead-eye-jim" balance={0} now={new Date("2026-07-16T09:00:00Z")} onRedeem={() => {}} redeeming={false} />);
    const link = screen.getByRole("link", { name: /timeline/i });
    expect(link).toHaveAttribute("href", "/players/dead-eye-jim/chernarus/lives/7");
    // ⚠️ --red-deep is a light-surface-only token: on bg-dark it fails AA. RTL asserts the DOM,
    // not contrast, so this token assertion is the only thing standing between us and an
    // invisible-but-present control on a phone.
    expect(link.className).toContain("red-soft");
    expect(link.className).not.toContain("red-deep");
  });
});
