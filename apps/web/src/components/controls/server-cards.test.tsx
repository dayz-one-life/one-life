import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ServerCard } from "./server-cards";
import type { ServerCardData } from "./format";
import { diedAtLabel } from "./format";

const NOW = new Date("2026-07-16T12:00:00Z");

const alive: ServerCardData = {
  slug: "chernarus", map: "chernarusplus", state: "alive", lifeNumber: 5,
  alive: { timeAliveSeconds: 22920, kills: 0 }, ban: null,
};
const idle: ServerCardData = { slug: "livonia", map: "enoch", state: "idle", lifeNumber: null, alive: null, ban: null };
const banned: ServerCardData = {
  slug: "sakhal", map: "sakhal", state: "banned", lifeNumber: 3, alive: null,
  ban: { banId: 9, bannedAt: "2026-07-16T09:47:00Z", expiresAt: "2026-07-17T01:58:00Z", liftPending: false },
};
const expiredBanned: ServerCardData = {
  slug: "sakhal", map: "sakhal", state: "banned", lifeNumber: 3, alive: null,
  ban: { banId: 9, bannedAt: "2026-07-16T09:47:00Z", expiresAt: "2026-07-16T10:00:00Z", liftPending: false },
};

const base = { ownSlug: "bootscoldwater", balance: 3, now: NOW, onRedeem: () => {}, redeeming: false };

describe("ServerCard", () => {
  test("alive: blue chip and fact line", () => {
    const { container } = render(<ServerCard card={alive} {...base} />);
    expect(screen.getByText("Alive")).toBeInTheDocument();
    // The alive fixture also carries a lifeNumber, so the fact line now shares its <p> with a
    // Timeline link (rendered for any card with a known lifeNumber, not just banned ones) — assert
    // the full exact text including the new suffix.
    const factParagraph = container.querySelector("p");
    expect(factParagraph?.textContent).toBe("Qualified · 6h 22m this life · 0 kills · Timeline →");
  });

  test("idle: dashed chip and the grace invitation", () => {
    render(<ServerCard card={idle} {...base} />);
    expect(screen.getByText("No life")).toBeInTheDocument();
    expect(screen.getByText("Spawn in any time. First 5 minutes are free.")).toBeInTheDocument();
  });

  test("banned: red chip, died line with obituary link, countdown, spend CTA", () => {
    const onRedeem = vi.fn();
    render(<ServerCard card={banned} {...base} onRedeem={onRedeem} />);
    expect(screen.getByText("Banned")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Died ${diedAtLabel("2026-07-16T09:47:00Z")}`))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /obituary/i })).toHaveAttribute("href", "/players/bootscoldwater");
    expect(screen.getByText("Ban lifts in")).toBeInTheDocument();
    expect(screen.getByText("13h 58m")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Spend 1 token — skip the wait" }));
    expect(onRedeem).toHaveBeenCalledWith(9);
  });

  test("banned past expiry: terminal Lifting state, no dead 0h 0m timer", () => {
    render(<ServerCard card={expiredBanned} {...base} />);
    expect(screen.getByText("Lifting…")).toBeInTheDocument();
    expect(screen.queryByText(/0h 0m/)).not.toBeInTheDocument();
    expect(screen.queryByText("Ban lifts in")).not.toBeInTheDocument();
  });

  test("banned with no tokens: notice instead of CTA", () => {
    render(<ServerCard card={banned} {...base} balance={0} />);
    expect(screen.queryByRole("button", { name: /spend 1 token/i })).not.toBeInTheDocument();
    expect(screen.getByText("No unban tokens")).toBeInTheDocument();
  });

  test("banned with lift pending: mono pending notice", () => {
    const card = { ...banned, ban: { ...banned.ban!, liftPending: true } };
    render(<ServerCard card={card} {...base} />);
    // Two nodes now carry this text — the always-mounted sr-only status announcer plus the
    // visible notice — so scope to the visible one specifically.
    const notices = screen.getAllByText("Unban pending — lifting shortly…");
    expect(notices).toHaveLength(2);
    const visible = notices.find((el) => !el.className.includes("sr-only"));
    expect(visible).toBeInTheDocument();
  });

  // live-data honesty §5 fix round 1: `balance` can be unresolved independently of `card`'s own
  // state. A banned card must not assert "No unban tokens" (or render the spend CTA) before the
  // tokens query settles — that's the exact bug self-unban-button.tsx was already fixed to avoid.
  test("banned with balance unresolved: checking placeholder, never a fabricated no-tokens CTA", () => {
    render(<ServerCard card={banned} {...base} balance={0} balanceLoading />);
    expect(screen.queryByText("No unban tokens")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /spend 1 token/i })).not.toBeInTheDocument();
    expect(screen.getByText(/checking your tokens/i)).toBeInTheDocument();
  });

  test("banned with balance resolved to a real zero: still shows the no-tokens notice", () => {
    render(<ServerCard card={banned} {...base} balance={0} balanceLoading={false} />);
    expect(screen.getByText("No unban tokens")).toBeInTheDocument();
  });

  test("lift-already-pending wins even while the balance is unresolved", () => {
    const card = { ...banned, ban: { ...banned.ban!, liftPending: true } };
    render(<ServerCard card={card} {...base} balanceLoading />);
    expect(screen.queryByText(/checking your tokens/i)).not.toBeInTheDocument();
    const notices = screen.getAllByText("Unban pending — lifting shortly…");
    expect(notices.find((el) => !el.className.includes("sr-only"))).toBeInTheDocument();
  });

  test("links an alive card to the life timeline", () => {
    render(<ServerCard card={{ ...alive, lifeNumber: 4 }} ownSlug="dead-eye-jim" balance={0} now={NOW} onRedeem={() => {}} redeeming={false} />);
    expect(screen.getByRole("link", { name: /timeline/i })).toHaveAttribute("href", "/players/dead-eye-jim/chernarus/lives/4");
  });

  test("renders no timeline link when the life number is unknown", () => {
    render(<ServerCard card={{ ...alive, lifeNumber: null }} ownSlug="dead-eye-jim" balance={0} now={NOW} onRedeem={() => {}} redeeming={false} />);
    expect(screen.queryByRole("link", { name: /timeline/i })).toBeNull();
  });

  test("renders no timeline link when the viewer has no slug", () => {
    render(<ServerCard card={{ ...alive, lifeNumber: 4 }} ownSlug={null} balance={0} now={NOW} onRedeem={() => {}} redeeming={false} />);
    expect(screen.queryByRole("link", { name: /timeline/i })).toBeNull();
  });

  test("links to the life timeline with LIGHT-SURFACE tokens, not the dark-surface red", () => {
    render(<ServerCard card={{ ...alive, lifeNumber: 4 }} ownSlug="dead-eye-jim" balance={0} now={NOW} onRedeem={() => {}} redeeming={false} />);
    const link = screen.getByRole("link", { name: /timeline/i });
    expect(link).toHaveAttribute("href", "/players/dead-eye-jim/chernarus/lives/4");
    // ⚠️ --red-deep is a light-surface-only token: on bg-dark it fails AA. RTL asserts the DOM,
    // not contrast, so this token assertion is the only thing standing between us and an
    // invisible-but-present control on dark surfaces. The rail is the light surface.
    expect(link.className).toContain("red-deep");
    expect(link.className).not.toContain("red-soft");
  });
});
