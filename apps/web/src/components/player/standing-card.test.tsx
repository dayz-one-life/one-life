import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";
import { StandingCard } from "./standing-card";

const now = new Date("2026-07-14T12:00:00Z");
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const base: any = { serverId: 1, map: "chernarusplus", slug: "chern", character: null, alive: null, ban: null };

describe("StandingCard", () => {
  it("shows alive stats + kill list with no <details>", () => {
    const { container } = wrap(<StandingCard now={now} pageGamertag="Legend" standing={{ ...base, state: "alive", alive: { lifeId: 1, startedAt: now.toISOString(), timeAliveSeconds: 3600, kills: 9, longestKillMeters: 312, killList: [] } }} />);
    expect(container.querySelector("details")).toBeNull();
    expect(screen.getByText("Chernarus")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("312m")).toBeInTheDocument();
  });
  it("shows the ban countdown", () => {
    wrap(<StandingCard now={now} pageGamertag="Legend" standing={{ ...base, state: "banned", ban: { banId: 5, bannedAt: now.toISOString(), expiresAt: "2026-07-14T14:00:00Z", liftPending: false, triggeringLifeNumber: 1 } }} />);
    expect(screen.getByText(/2h 0m/)).toBeInTheDocument();
    expect(screen.getByText(/ban lifts in/i)).toBeInTheDocument();
  });
});
