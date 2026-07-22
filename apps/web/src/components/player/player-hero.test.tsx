import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test } from "vitest";
import { PlayerHero } from "./player-hero";
import type { PlayerPage } from "@/lib/types";

// PlayerHero mounts FriendButton, which reads useFriendStatus/useFriendActions —
// both TanStack Query hooks, so every render here needs a QueryClientProvider (same
// pattern as standing-card.test.tsx, which mounts SelfUnbanButton).
function renderHero(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function page(overrides: Partial<PlayerPage> = {}): PlayerPage {
  return {
    gamertag: "YrJustBad",
    verified: true,
    firstSeenAt: "2026-07-01T00:00:00Z",
    aliveAnywhere: true,
    totals: { kills: 2, lives: 4, deaths: 2, longestLifeSeconds: 82440 },
    standing: [
      { serverId: 1, map: "chernarusplus", slug: "chernarus", state: "alive", character: null, alive: null, ban: null, lastLifeNumber: null },
      { serverId: 2, map: "sakhal", slug: "sakhal", state: "alive", character: null, alive: null, ban: null, lastLifeNumber: null },
    ],
    pastLives: [],
    pastLivesTotal: 0,
    pastLivesPage: 1,
    pastLivesPageSize: 10,
    ...overrides,
  };
}

describe("PlayerHero", () => {
  test("over-line, gamertag h1, alive badge, verified stamp", () => {
    renderHero(<PlayerHero page={page()} />);
    expect(screen.getByText("First seen Jul 2026 · alive on Chernarus, Sakhal")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "YrJustBad" })).toBeInTheDocument();
    expect(screen.getByText("Alive ×2")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });

  test("single alive server gets a plain Alive badge", () => {
    const p = page();
    const first = p.standing[0];
    if (!first) throw new Error("Expected standing[0]");
    p.standing = [first];
    renderHero(<PlayerHero page={p} />);
    expect(screen.getByText("Alive")).toBeInTheDocument();
    expect(screen.getByText("First seen Jul 2026 · alive on Chernarus")).toBeInTheDocument();
  });

  test("dead everywhere: no badge, no alive segment", () => {
    renderHero(<PlayerHero page={page({ standing: [], aliveAnywhere: false })} />);
    expect(screen.queryByText(/Alive/)).not.toBeInTheDocument();
    expect(screen.getByText("First seen Jul 2026")).toBeInTheDocument();
  });

  test("no firstSeenAt: over-line omitted", () => {
    renderHero(<PlayerHero page={page({ firstSeenAt: null })} />);
    expect(screen.queryByText(/First seen/)).not.toBeInTheDocument();
  });

  test("unverified: no stamp", () => {
    renderHero(<PlayerHero page={page({ verified: false })} />);
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
  });

  test("Deaths is the red stat", () => {
    renderHero(<PlayerHero page={page()} />);
    const block = screen.getByText("Deaths").closest("div")!;
    const value = within(block).getByText(String(page().totals.deaths));
    expect(value.className).toContain("text-red");
  });
});
