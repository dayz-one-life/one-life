import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";
import { StandingCard } from "./standing-card";

const now = new Date("2026-07-14T12:00:00Z");
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const base: any = { serverId: 1, map: "chernarusplus", slug: "chern", alive: null, ban: null };

const aliveStanding: any = {
  ...base,
  state: "alive",
  alive: { lifeId: 1, startedAt: now.toISOString(), timeAliveSeconds: 3600, kills: 9, longestKillMeters: 312, killList: [] },
};

const bannedStanding: any = {
  ...base,
  state: "banned",
  ban: { banId: 5, bannedAt: now.toISOString(), expiresAt: "2026-07-14T14:00:00Z", liftPending: false, triggeringLifeNumber: 1 },
};

const expiredBannedStanding: any = {
  ...base,
  state: "banned",
  ban: { banId: 5, bannedAt: now.toISOString(), expiresAt: "2026-07-14T10:00:00Z", liftPending: false, triggeringLifeNumber: 1 },
};

describe("StandingCard", () => {
  it("alive card: blue chip, 3-stat row, red kills label", () => {
    wrap(<StandingCard standing={aliveStanding} now={now} pageGamertag="YrJustBad" />);
    expect(screen.getByText("Chernarus")).toBeInTheDocument();
    // "Alive" now also opens the sub-line's own text ("Alive <span>1h 0m</span>"), so scope to
    // the state chip specifically.
    expect(screen.getByText("Alive", { selector: "span.bg-blue" }).className).toContain("bg-blue");
    expect(screen.getByText("Time alive")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("312 m")).toBeInTheDocument();
    expect(screen.getByText("Kills this life").className).toContain("text-red-deep");
  });

  it("banned card: red chip, red left border, ban box, countdown", () => {
    const { container } = wrap(<StandingCard standing={bannedStanding} now={now} pageGamertag="YrJustBad" />);
    expect(screen.getByText("Banned").className).toContain("bg-red");
    expect((container.firstChild as HTMLElement).className).toContain("border-l-red");
    expect(screen.getByText("Ban lifts in")).toBeInTheDocument();
    expect(screen.getByText(/2h 0m/)).toBeInTheDocument();
    expect(screen.getByText(/Died — awaiting respawn/)).toBeInTheDocument();
  });

  it("banned card past expiry: terminal Lifting state, no dead 0h 0m timer", () => {
    wrap(<StandingCard standing={expiredBannedStanding} now={now} pageGamertag="YrJustBad" />);
    expect(screen.getByText("Lifting…")).toBeInTheDocument();
    expect(screen.queryByText(/0h 0m/)).not.toBeInTheDocument();
    expect(screen.queryByText("Ban lifts in")).not.toBeInTheDocument();
  });

  it("the Alive sub-line duration is exempt from its row's uppercase (#9)", () => {
    const standing: any = {
      serverId: 1, map: "sakhal", slug: "sakhal", state: "alive",
      alive: { lifeId: 5, lifeNumber: 3, startedAt: "2026-07-16T00:00:00Z", timeAliveSeconds: 3600, kills: 0, longestKillMeters: null, killList: [] },
      ban: null,
    };
    const { container } = wrap(<StandingCard standing={standing} now={now} pageGamertag="YrJustBad" />);
    // The identical duration also renders unwrapped in the stat band below (Stat's value span
    // carries no uppercase, so it needs no exemption) — assert the sub-line's own span, scoped to
    // the uppercase mono <p> that renders it (not the stat band).
    const subLine = container.querySelector("p.uppercase")!;
    expect(subLine).not.toBeNull();
    const value = subLine.querySelector("span.normal-case");
    expect(value).not.toBeNull();
    expect(value).toHaveTextContent("1h 0m");
  });

  it("null longest kill renders a muted dash", () => {
    wrap(
      <StandingCard
        standing={{ ...aliveStanding, alive: { ...aliveStanding.alive, longestKillMeters: null } }}
        now={now}
        pageGamertag="x"
      />
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("StandingCard heading", () => {
  it("renders the map name as an h3 (player-profile.tsx nests cards under an h2 section)", () => {
    wrap(<StandingCard standing={aliveStanding} now={now} pageGamertag="YrJustBad" />);
    expect(screen.getByRole("heading", { level: 3, name: "Chernarus" })).toBeInTheDocument();
  });
});

describe("StandingCard timeline link", () => {
  it("alive standing links to that life's timeline", () => {
    const standing: any = {
      serverId: 1, map: "sakhal", slug: "sakhal", state: "alive",
      alive: { lifeId: 5, lifeNumber: 3, startedAt: "2026-07-16T00:00:00Z", timeAliveSeconds: 3600, kills: 0, longestKillMeters: null, killList: [] },
      ban: null,
    };
    wrap(<StandingCard standing={standing} now={now} pageGamertag="YrJustBad" />);
    expect(screen.getByRole("link", { name: /timeline/i })).toHaveAttribute("href", "/players/yrjustbad/sakhal/lives/3");
  });
});
