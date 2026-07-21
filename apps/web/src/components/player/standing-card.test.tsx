import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";
import { StandingCard } from "./standing-card";

const now = new Date("2026-07-14T12:00:00Z");
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const base: any = { serverId: 1, map: "chernarusplus", slug: "chern", character: null, alive: null, ban: null };

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

describe("StandingCard", () => {
  it("alive card: blue chip, 3-stat row, red kills label", () => {
    wrap(<StandingCard standing={aliveStanding} now={now} pageGamertag="YrJustBad" />);
    expect(screen.getByText("Chernarus")).toBeInTheDocument();
    expect(screen.getByText("Alive").className).toContain("bg-blue");
    expect(screen.getByText("Time alive")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("312m")).toBeInTheDocument();
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

describe("StandingCard timeline link", () => {
  it("alive standing links to that life's timeline", () => {
    const standing: any = {
      serverId: 1, map: "sakhal", slug: "sakhal", state: "alive", character: null,
      alive: { lifeId: 5, lifeNumber: 3, startedAt: "2026-07-16T00:00:00Z", timeAliveSeconds: 3600, kills: 0, longestKillMeters: null, killList: [] },
      ban: null,
    };
    wrap(<StandingCard standing={standing} now={now} pageGamertag="YrJustBad" />);
    expect(screen.getByRole("link", { name: /timeline/i })).toHaveAttribute("href", "/players/yrjustbad/sakhal/lives/3");
  });
});
