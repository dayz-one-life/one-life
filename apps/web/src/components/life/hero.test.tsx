import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { LifeHero } from "./hero";
import { buildTimeline } from "@/lib/life-timeline";
import type { LifeTimelineData } from "@/lib/types";

const start = "2026-07-14T00:00:00Z";
function data(over: Partial<LifeTimelineData> = {}): LifeTimelineData {
  return {
    gamertag: "YrJustBad", map: "sakhal", slug: "sakhal",
    life: { id: 1, serverId: 1, playerId: 1, lifeNumber: 4, startedAt: start, endedAt: null, deathCause: null, deathByGamertag: null, deathWeapon: null, deathDistance: null, energyAtDeath: null, waterAtDeath: null, bleedSourcesAtDeath: null, playtimeSeconds: 0 },
    sessions: [{ id: 1, serverId: 1, playerId: 1, lifeId: 1, connectedAt: start, disconnectedAt: null, durationSeconds: null, closeReason: null }],
    kills: [], qualifiedAt: { at: start, by: "playtime" },
    character: { charId: 1, characterClass: "SurvivorM_Cyril", name: "Cyril", gender: "male", sightings: 3, confidence: "exact" },
    verdict: null,
    ...over,
  };
}

describe("LifeHero", () => {
  test("alive: factual h1, Alive badge, gamertag links to dossier, QUALIFIED check", () => {
    const now = new Date(Date.parse(start) + 100 * 60_000);
    render(<LifeHero data={data()} view={buildTimeline(data(), now)} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Life 4 · Sakhal");
    expect(screen.getByText("Alive")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "YrJustBad" })).toHaveAttribute("href", "/players/yrjustbad");
    expect(screen.getAllByText("Qualified").length).toBeGreaterThan(0);
  });

  test("Qualified stat: glyph is decorative, value has an sr-only text equivalent", () => {
    const now = new Date(Date.parse(start) + 100 * 60_000);
    const { container } = render(<LifeHero data={data()} view={buildTimeline(data(), now)} />);
    const glyph = screen.getByText("✓");
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    // The value node (glyph + sr-only text) exposes "Qualified" as its accessible name.
    const srText = container.querySelector(".sr-only");
    expect(srText).toHaveTextContent("Qualified");
    expect(srText!.parentElement).toHaveAccessibleName("Qualified");
  });

  test("Qualified stat: unqualified life reads 'Not qualified' for AT, dash is decorative", () => {
    const now = new Date(Date.parse(start) + 400 * 60_000);
    const d = data({ qualifiedAt: null });
    const { container } = render(<LifeHero data={d} view={buildTimeline(d, now)} />);
    const glyph = screen.getByText("—", { selector: "[aria-hidden]" });
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    const srText = container.querySelector(".sr-only");
    expect(srText).toHaveTextContent("Not qualified");
    expect(srText!.parentElement).toHaveAccessibleName("Not qualified");
  });

  test("dead: Died chip instead of Alive", () => {
    const now = new Date(Date.parse(start) + 400 * 60_000);
    const d = data({ life: { ...data().life, endedAt: "2026-07-14T06:00:00Z", deathCause: "pvp", playtimeSeconds: 21600 } });
    render(<LifeHero data={d} view={buildTimeline(d, now)} />);
    expect(screen.getByText("Died")).toBeInTheDocument();
    expect(screen.queryByText("Alive")).not.toBeInTheDocument();
  });

  test("portrait falls back to silhouette when no character", () => {
    const now = new Date(Date.parse(start) + 100 * 60_000);
    const d = data({ character: null });
    const { container } = render(<LifeHero data={d} view={buildTimeline(d, now)} />);
    expect(container.querySelector("img")).toBeNull(); // silhouette svg, not an img
  });
});
