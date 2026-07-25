import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ServerCard, StateChip } from "./server-cards";
import type { ServerCardData } from "@/components/account/format";
import { diedAtLabel } from "@/components/account/format";

const NOW = new Date("2026-07-16T12:00:00Z");

const alive: ServerCardData = {
  slug: "chernarus", map: "chernarusplus", state: "alive", lifeNumber: 5,
  alive: { timeAliveSeconds: 22920, kills: 0, qualified: true }, ban: null,
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
  test("alive renders as the hero: big time alive, and time alive is the ONLY stat", () => {
    const { container } = render(<ServerCard card={alive} {...base} />);
    expect(screen.getByText("Alive")).toBeInTheDocument();
    expect(screen.getByText("6h 22m")).toBeInTheDocument();
    // Home-is-the-app spec, amendment 2: no kills, no sessions, no "Qualified ·" ledger line.
    // These servers are about surviving; the one number is time alive.
    expect(container.textContent).not.toMatch(/kill/i);
    expect(container.textContent).not.toMatch(/session/i);
    expect(container.textContent).not.toMatch(/Qualified/);
    expect(screen.getByRole("link", { name: /timeline/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open map/i })).toHaveAttribute("href", "/maps/chernarus");
  });

  test("a provisional alive hero keeps the not-yet-qualified warning line", () => {
    const provisional = { ...alive, alive: { ...alive.alive!, timeAliveSeconds: 60, qualified: false } };
    render(<ServerCard card={provisional} {...base} />);
    expect(screen.getByText(/not yet qualified · death is free/i)).toBeInTheDocument();
  });

  test("idle: dashed chip and the grace invitation", () => {
    render(<ServerCard card={idle} {...base} />);
    expect(screen.getByText("No life")).toBeInTheDocument();
    expect(screen.getByText("Spawn in any time. First 5 minutes are free.")).toBeInTheDocument();
  });

  // Home-is-the-app spec §2: Join expands the SHARED HowToConnect content in place, per row.
  test("idle: Join discloses the shared how-to-connect content in place", () => {
    render(<ServerCard card={idle} {...base} joinServers={{ kind: "ready", names: ["Chernarus", "Sakhal"] }} />);
    const join = screen.getByRole("button", { name: /join/i });
    expect(join).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/how to connect/i)).not.toBeInTheDocument();
    fireEvent.click(join);
    expect(join).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/how to connect/i)).toBeInTheDocument();
    expect(screen.getByText("Chernarus, Sakhal")).toBeInTheDocument();
  });

  test("idle without a server list renders no Join control at all", () => {
    render(<ServerCard card={idle} {...base} />);
    expect(screen.queryByRole("button", { name: /join/i })).not.toBeInTheDocument();
  });

  test("banned: red chip, died line with dossier link, countdown, spend CTA", () => {
    const onRedeem = vi.fn();
    render(<ServerCard card={banned} {...base} onRedeem={onRedeem} />);
    expect(screen.getByText("Banned")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Died ${diedAtLabel("2026-07-16T09:47:00Z")}`))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /dossier/i })).toHaveAttribute("href", "/players/bootscoldwater");
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

  test("the hero timeline action is a solid ink-on-white button, never a dark-surface red", () => {
    render(<ServerCard card={{ ...alive, lifeNumber: 4 }} ownSlug="dead-eye-jim" balance={0} now={NOW} onRedeem={() => {}} redeeming={false} />);
    const link = screen.getByRole("link", { name: /timeline/i });
    expect(link).toHaveAttribute("href", "/players/dead-eye-jim/chernarus/lives/4");
    // RTL asserts the DOM, not contrast — pin the token pair so an ink-on-dark (or
    // paper-on-white) swap cannot ship invisible-but-present.
    expect(link.className).toContain("bg-ink");
    expect(link.className).toContain("text-paper");
    expect(link.className).not.toContain("red-soft");
  });

  test("a banned card's timeline link keeps LIGHT-SURFACE red-deep, not the dark-surface red", () => {
    render(<ServerCard card={banned} {...base} />);
    const link = screen.getByRole("link", { name: /timeline/i });
    // ⚠️ --red-deep is a light-surface-only token: on bg-dark it fails AA. The card is white.
    expect(link.className).toContain("red-deep");
    expect(link.className).not.toContain("red-soft");
  });
});

describe("StateChip: provisional lives read differently from qualified ones", () => {
  // The chip is the at-a-glance signal. "Alive" on a provisional life implies the life counts —
  // it does not yet. Amber + outline (not the solid blue) says "provisional" without a legend.
  // `yellow` is the design system's existing provisional/attention token (the Longest-kill chip
  // uses it); the spec said "amber", but inventing a token for one chip is not worth it. Outlined
  // rather than solid — "hollow" per the spec — which also dodges a white-on-yellow contrast trap.
  test("a provisional life is yellow-outlined and says Not yet, not Alive", () => {
    render(<StateChip state="alive" qualified={false} />);
    const chip = screen.getByText(/not yet/i);
    expect(chip.className).toMatch(/border-yellow/);
    expect(chip.className).not.toMatch(/bg-blue/);
  });

  test("a qualified life keeps the solid blue Alive chip", () => {
    render(<StateChip state="alive" qualified />);
    const chip = screen.getByText("Alive");
    expect(chip.className).toMatch(/bg-blue/);
  });

  test("qualified defaults to true, so every existing caller is unchanged", () => {
    render(<StateChip state="alive" />);
    expect(screen.getByText("Alive").className).toMatch(/bg-blue/);
  });
});
