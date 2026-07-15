import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StandingCard } from "./standing-card";
const now = new Date("2026-07-14T12:00:00Z");

// StandingCard renders SelfUnbanButton (Task 6), which calls useGamertagLinks() —
// a useQuery hook — unconditionally, so tests need a QueryClientProvider ancestor.
// Same pattern as header.test.tsx's renderMasthead().
function renderStandingCard(props: React.ComponentProps<typeof StandingCard>) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <StandingCard {...props} />
    </QueryClientProvider>,
  );
}

describe("StandingCard", () => {
  const base: any = { serverId: 1, map: "chernarusplus", slug: "chern", character: null, alive: null, ban: null, pageGamertag: "Legend" };
  it("shows alive stats", () => {
    renderStandingCard({ now, standing: { ...base, state: "alive", alive: { lifeId: 1, startedAt: now.toISOString(), timeAliveSeconds: 3600, kills: 9, longestKillMeters: 312, killList: [] } } });
    expect(screen.getByText("Chernarus")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("312m")).toBeInTheDocument();
  });
  it("shows ban countdown", () => {
    renderStandingCard({ now, standing: { ...base, state: "banned", ban: { banId: 5, bannedAt: now.toISOString(), expiresAt: "2026-07-14T14:00:00Z", liftPending: false, triggeringLifeNumber: 1 } } });
    expect(screen.getByText(/2h 0m/)).toBeInTheDocument();
    expect(screen.getByText(/ban lifts in/i)).toBeInTheDocument();
  });
});
