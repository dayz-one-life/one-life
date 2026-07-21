import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Timeline } from "./timeline";
import { buildTimeline } from "@/lib/life-timeline";
import type { LifeTimelineData } from "@/lib/types";

const start = "2026-07-14T00:00:00Z";
const at = (m: number) => new Date(Date.parse(start) + m * 60_000).toISOString();
function data(over: Partial<LifeTimelineData> = {}): LifeTimelineData {
  return {
    gamertag: "YrJustBad", map: "sakhal", slug: "sakhal",
    life: { id: 1, serverId: 1, playerId: 1, lifeNumber: 4, startedAt: start, endedAt: null, deathCause: null, deathByGamertag: null, deathWeapon: null, deathDistance: null, energyAtDeath: null, waterAtDeath: null, bleedSourcesAtDeath: null, playtimeSeconds: 0 },
    sessions: [{ id: 1, serverId: 1, playerId: 1, lifeId: 1, connectedAt: start, disconnectedAt: null, durationSeconds: null, closeReason: null }],
    kills: [{ victimGamertag: "Tomahawked11", weapon: "VSS", distanceMeters: 5, occurredAt: at(90) }],
    qualifiedAt: { at: at(5), by: "playtime" }, character: null,
    verdict: null,
    ...over,
  };
}

describe("Timeline", () => {
  test("alive: shows the Positions withheld bar and a NOW label", () => {
    const now = new Date(Date.parse(start) + 200 * 60_000);
    render(<Timeline view={buildTimeline(data(), now)} />);
    expect(screen.getByText("Positions withheld")).toBeInTheDocument();
    expect(screen.getByText("NOW")).toBeInTheDocument();
    expect(screen.getByText("Still drawing breath")).toBeInTheDocument();
  });

  test("kill row links the victim and shows weapon · distance", () => {
    const now = new Date(Date.parse(start) + 200 * 60_000);
    render(<Timeline view={buildTimeline(data(), now)} />);
    expect(screen.getByRole("link", { name: "Tomahawked11" })).toBeInTheDocument();
    expect(screen.getByText(/VSS · 5m/)).toBeInTheDocument();
  });

  test("dead: no withheld bar, death row shows killer + vitals", () => {
    const now = new Date(Date.parse(start) + 400 * 60_000);
    const d = data({
      kills: [],
      life: { ...data().life, endedAt: at(360), deathCause: "pvp", deathByGamertag: "SomeKiller", deathWeapon: "VSD", deathDistance: 126, energyAtDeath: 42, waterAtDeath: 18, bleedSourcesAtDeath: 2, playtimeSeconds: 21600 },
    });
    render(<Timeline view={buildTimeline(d, now)} />);
    expect(screen.queryByText("Positions withheld")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "SomeKiller" })).toBeInTheDocument();
    expect(screen.getByText(/Energy 42 · Water 18 · bleeding ×2/)).toBeInTheDocument();
  });

  test("longest kill row shows the Longest kill chip", () => {
    const now = new Date(Date.parse(start) + 500 * 60_000);
    const d = data({ kills: [{ victimGamertag: "V", weapon: "KAS-74U", distanceMeters: 25, occurredAt: at(120) }] });
    render(<Timeline view={buildTimeline(d, now)} />);
    expect(screen.getByText("Longest kill")).toBeInTheDocument();
  });

  test("non-pvp death row renders the classified verdict phrase", () => {
    const now = new Date(Date.parse(start) + 400 * 60_000);
    const d = data({
      kills: [],
      verdict: { cause: "starvation", confidence: "low", conditions: ["starving"] },
      life: { ...data().life, endedAt: at(360), deathCause: "environment", deathByGamertag: null, deathWeapon: null, deathDistance: null, energyAtDeath: 0, waterAtDeath: 10, bleedSourcesAtDeath: 0, playtimeSeconds: 21600 },
    });
    render(<Timeline view={buildTimeline(d, now)} />);
    expect(screen.getByText(/Died — Likely starvation/i)).toBeInTheDocument();
  });

  test("event sequence is an ordered list — one listitem per event, list-none reset", () => {
    const now = new Date(Date.parse(start) + 400 * 60_000);
    const d = data({
      kills: [{ victimGamertag: "V", weapon: "KAS-74U", distanceMeters: 25, occurredAt: at(120) }],
      life: { ...data().life, endedAt: at(360), deathCause: "pvp", deathByGamertag: "SomeKiller", deathWeapon: "VSD", deathDistance: 126, energyAtDeath: 42, waterAtDeath: 18, bleedSourcesAtDeath: 2, playtimeSeconds: 21600 },
    });
    const view = buildTimeline(d, now);
    render(<Timeline view={view} />);
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("OL");
    expect(list.className).toContain("list-none");
    expect(list.className).toContain("mt-4");
    expect(screen.getAllByRole("listitem")).toHaveLength(view.events.length);
  });
});
