import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { PlayerProfile } from "./player-profile";
import type { PlayerPage, ServerStanding, PastLife } from "@/lib/types";

const standing = (serverId: number, state: ServerStanding["state"] = "alive"): ServerStanding => ({
  serverId,
  map: serverId === 1 ? "chernarusplus" : "sakhal",
  slug: serverId === 1 ? "chernarus" : "sakhal",
  state,
  character: null,
  alive:
    state === "alive"
      ? { lifeId: serverId, lifeNumber: 1, startedAt: "2026-07-01T00:00:00Z", timeAliveSeconds: 3600, kills: 0, longestKillMeters: null, killList: [] }
      : null,
  ban: null,
});

const pastLife = (lifeId: number): PastLife => ({
  lifeId,
  serverId: 1,
  map: "chernarusplus",
  slug: "chernarus",
  lifeNumber: lifeId,
  startedAt: "2026-06-01T00:00:00Z",
  endedAt: "2026-06-02T00:00:00Z",
  timeAliveSeconds: 3600,
  kills: 0,
  longestKillMeters: null,
  character: null,
  death: { cause: null, byGamertag: null, weapon: null, distanceMeters: null, verdict: null },
  vitals: { energy: null, water: null, bleedSources: null },
  sessions: 1,
  killList: [],
});

function page(overrides: Partial<PlayerPage> = {}): PlayerPage {
  return {
    gamertag: "YrJustBad",
    verified: true,
    firstSeenAt: "2026-07-01T00:00:00Z",
    aliveAnywhere: true,
    totals: { kills: 2, lives: 4, deaths: 2, longestLifeSeconds: 82440 },
    standing: [standing(1), standing(2)],
    pastLives: [pastLife(1), pastLife(2), pastLife(3)],
    pastLivesTotal: 3,
    pastLivesPage: 1,
    pastLivesPageSize: 10,
    ...overrides,
  };
}

const NOW = new Date("2026-07-20T12:00:00Z");

describe("PlayerProfile", () => {
  test("Current standing is a list — one listitem per card, grid classes + list-none preserved", () => {
    render(<PlayerProfile page={page()} now={NOW} />);
    const heading = screen.getByRole("heading", { name: "Current standing" });
    const section = heading.closest("section")!;
    const list = within(section).getByRole("list");
    expect(list.tagName).toBe("UL");
    expect(list.className).toContain("grid");
    expect(list.className).toContain("md:grid-cols-2");
    expect(list.className).toContain("gap-5");
    expect(list.className).toContain("list-none");
    expect(within(section).getAllByRole("listitem")).toHaveLength(page().standing.length);
  });

  test("Past lives is a separate list — one listitem per funeral card, grid classes + list-none preserved", () => {
    render(<PlayerProfile page={page()} now={NOW} />);
    const heading = screen.getByRole("heading", { name: /Past lives/ });
    const section = heading.closest("section")!;
    const list = within(section).getByRole("list");
    expect(list.tagName).toBe("UL");
    expect(list.className).toContain("grid");
    expect(list.className).toContain("md:grid-cols-2");
    expect(list.className).toContain("gap-5");
    expect(list.className).toContain("list-none");
    expect(within(section).getAllByRole("listitem")).toHaveLength(page().pastLives.length);
  });

  test("Current standing section is omitted when everyone is idle — no stray list", () => {
    render(<PlayerProfile page={page({ standing: [standing(1, "idle")] })} now={NOW} />);
    expect(screen.queryByRole("heading", { name: "Current standing" })).not.toBeInTheDocument();
  });
});
