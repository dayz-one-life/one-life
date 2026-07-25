import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { StandingGroups } from "./standing-groups";
import type { ServerCardData } from "@/components/account/format";

const NOW = new Date("2026-07-16T12:00:00Z");

const alive: ServerCardData = {
  slug: "chernarus", map: "chernarusplus", state: "alive", lifeNumber: 12,
  alive: { timeAliveSeconds: 352920, kills: 14, qualified: true, startedAt: "2026-07-12T09:00:00Z" },
  ban: null, lastEndedAt: null,
};
const idle: ServerCardData = { slug: "livonia", map: "enoch", state: "idle", lifeNumber: null, alive: null, ban: null, lastEndedAt: null };
const idleDied: ServerCardData = {
  slug: "sakhal", map: "sakhal", state: "idle", lifeNumber: 3, alive: null, ban: null,
  lastEndedAt: "2026-07-14T10:00:00Z",
};
const banned: ServerCardData = {
  slug: "sakhal", map: "sakhal", state: "banned", lifeNumber: 7, alive: null, lastEndedAt: null,
  ban: {
    banId: 9, bannedAt: "2026-07-16T09:47:00Z", expiresAt: "2026-07-17T06:00:00Z", liftPending: false,
    verdict: { cause: "mauled", confidence: "high", conditions: [] },
  },
};

const base = {
  ownSlug: "ronaldraygun552", balance: 3, balanceLoading: false, previousBestSeconds: 0,
  now: NOW, onRedeem: () => {}, redeeming: false,
  joinServers: { kind: "ready" as const, names: ["Chernarus", "Sakhal"] },
};

describe("StandingGroups — the verified-desktop mock, with the amendments", () => {
  test("alive hero: overline, big time alive, since date, Timeline + Open map", () => {
    render(<StandingGroups {...base} cards={[alive]} />);
    expect(screen.getByText(/Alive · Chernarus · Life 12/)).toBeInTheDocument();
    expect(screen.getByText("since Jul 12")).toBeInTheDocument();
    expect(screen.getByText("4d 2h")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /timeline/i })).toHaveAttribute(
      "href", "/players/ronaldraygun552/chernarus/lives/12",
    );
    expect(screen.getByRole("link", { name: /open map/i })).toHaveAttribute("href", "/maps/chernarus");
  });

  test("time alive is the ONLY stat — no kills, no sessions, no rank (amendment 2)", () => {
    const { container } = render(<StandingGroups {...base} cards={[alive]} />);
    expect(container.textContent).not.toMatch(/kill/i);
    expect(container.textContent).not.toMatch(/session/i);
    expect(container.textContent).not.toMatch(/#\d/);
  });

  test("the record flourish appears only when the current run beats the previous best", () => {
    const { rerender } = render(<StandingGroups {...base} cards={[alive]} previousBestSeconds={300000} />);
    expect(screen.getByText(/Your longest run yet\. Previous best: 3d 11h\./)).toBeInTheDocument();
    rerender(<StandingGroups {...base} cards={[alive]} previousBestSeconds={400000} />);
    expect(screen.queryByText(/longest run yet/i)).toBeNull();
    // No ended life on record: nothing to compare against, so no claim is made.
    rerender(<StandingGroups {...base} cards={[alive]} previousBestSeconds={0} />);
    expect(screen.queryByText(/longest run yet/i)).toBeNull();
  });

  test("a provisional life keeps the death-is-free warning and never the record flourish", () => {
    const provisional = { ...alive, alive: { ...alive.alive!, timeAliveSeconds: 60, qualified: false } };
    render(<StandingGroups {...base} cards={[provisional]} previousBestSeconds={10} />);
    expect(screen.getByText(/not yet qualified · death is free/i)).toBeInTheDocument();
    expect(screen.queryByText(/longest run yet/i)).toBeNull();
  });

  test("banned group: header with tokens in hand, countdown, and the death that earned it", () => {
    render(<StandingGroups {...base} cards={[banned]} />);
    expect(screen.getByText("Banned · 1 server")).toBeInTheDocument();
    expect(screen.getByText("3 tokens in hand")).toBeInTheDocument();
    expect(screen.getByText("18h 0m")).toBeInTheDocument();
    expect(screen.getByText("mauled · life 7")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /spend 1 token/i })).toBeInTheDocument();
  });

  test("tokens-in-hand is withheld while the balance is unresolved (live-data honesty)", () => {
    render(<StandingGroups {...base} cards={[banned]} balanceLoading balance={0} />);
    expect(screen.queryByText(/tokens? in hand/)).toBeNull();
    expect(screen.queryByText("No unban tokens")).toBeNull();
  });

  test("a verdict-less ban shows the life number alone, never a guessed cause", () => {
    const noVerdict = { ...banned, ban: { ...banned.ban!, verdict: null } };
    render(<StandingGroups {...base} cards={[noVerdict]} />);
    expect(screen.getByText("life 7")).toBeInTheDocument();
    expect(screen.queryByText(/unknown/i)).toBeNull();
  });

  test("idle group: compact rows with died-ago / never-played datelines", () => {
    render(<StandingGroups {...base} cards={[idleDied, idle, alive]} />);
    expect(screen.getByText("No life · 2 servers")).toBeInTheDocument();
    expect(screen.getByText(/· died 2d ago · life 3/)).toBeInTheDocument();
    expect(screen.getByText(/· never played/)).toBeInTheDocument();
  });

  test("when every server is idle the header says so — not a countable 'No life · N'", () => {
    render(<StandingGroups {...base} cards={[idleDied, idle]} />);
    expect(screen.getByText("Your servers · nothing running")).toBeInTheDocument();
    expect(screen.queryByText(/No life · \d/)).toBeNull();
  });

  test("a ban collapses alive to a compact row group — the countdown leads the page", () => {
    render(<StandingGroups {...base} cards={[alive, banned]} />);
    expect(screen.getByText("Alive · 1 server")).toBeInTheDocument();
    expect(screen.getByText("4d 2h")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Map" })).toHaveAttribute("href", "/maps/chernarus");
    // No hero: neither of its buttons render.
    expect(screen.queryByRole("link", { name: /open map/i })).toBeNull();
    expect(screen.queryByText(/longest run yet/i)).toBeNull();
  });

  test("idle Join discloses the shared how-to-connect content in place", () => {
    render(<StandingGroups {...base} cards={[idle]} />);
    const join = screen.getByRole("button", { name: /join/i });
    expect(screen.queryByText(/how to connect/i)).toBeNull();
    fireEvent.click(join);
    expect(screen.getByText(/how to connect/i)).toBeInTheDocument();
    expect(screen.getByText("Chernarus, Sakhal")).toBeInTheDocument();
  });

  test("groups render banned → alive → idle", () => {
    render(<StandingGroups {...base} cards={[idle, alive, banned]} />);
    const labels = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(labels).toEqual(["Serving a ban", "Alive", "No life"]);
  });

  test("without a ban, alive keeps its full hero", () => {
    render(<StandingGroups {...base} cards={[idle, alive]} />);
    const labels = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(labels).toEqual(["Alive on Chernarus", "No life"]);
    expect(screen.getByRole("link", { name: /open map/i })).toBeInTheDocument();
  });

  test("spend fires with the ban id", () => {
    const onRedeem = vi.fn();
    render(<StandingGroups {...base} cards={[banned]} onRedeem={onRedeem} />);
    fireEvent.click(screen.getByRole("button", { name: /spend 1 token/i }));
    expect(onRedeem).toHaveBeenCalledWith(9);
  });
});
