import { describe, expect, test, vi } from "vitest";
// FitLine observes its container with ResizeObserver, which jsdom lacks.
vi.stubGlobal(
  "ResizeObserver",
  vi.fn().mockImplementation(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })),
);
import { render, screen } from "@testing-library/react";
import { LifeHero } from "./hero";
import { buildTimeline } from "@/lib/life-timeline";
import type { LifeTimelineData } from "@/lib/types";

const start = "2026-07-14T00:00:00Z";
function data(over: Partial<LifeTimelineData> = {}): LifeTimelineData {
  return {
    gamertag: "YrJustBad", map: "sakhal", slug: "sakhal", lastSeenAt: null, avatarHash: null, obituarySlug: null,
    life: { id: 1, serverId: 1, playerId: 1, lifeNumber: 4, startedAt: start, endedAt: null, deathCause: null, deathByGamertag: null, deathWeapon: null, deathDistance: null, energyAtDeath: null, waterAtDeath: null, bleedSourcesAtDeath: null, playtimeSeconds: 0 },
    sessions: [{ id: 1, serverId: 1, playerId: 1, lifeId: 1, connectedAt: start, disconnectedAt: null, durationSeconds: null, closeReason: null }],
    kills: [], qualifiedAt: { at: start, by: "playtime" },
    encounters: [],
    verdict: null,
    ...over,
  };
}

function alive() {
  return data();
}

function dead() {
  return data({ life: { ...data().life, endedAt: "2026-07-14T06:00:00Z", deathCause: "pvp", playtimeSeconds: 21600 } });
}

function view(d: LifeTimelineData) {
  return buildTimeline(d, new Date(Date.parse(start) + 400 * 60_000));
}

describe("LifeHero", () => {
  test("h1 reads 'Life {n} · {map}'", () => {
    const d = alive();
    render(<LifeHero data={d} view={view(d)} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Life 4 · Sakhal");
  });

  test("kicker reads 'A life of {gamertag}' with gamertag linking to the dossier", () => {
    const d = alive();
    render(<LifeHero data={d} view={view(d)} />);
    expect(screen.getByText(/^A life of/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "YrJustBad" })).toHaveAttribute("href", "/players/yrjustbad");
  });

  test("alive life shows the Alive badge, not Died", () => {
    const d = alive();
    render(<LifeHero data={d} view={view(d)} />);
    expect(screen.getByText("Alive")).toBeInTheDocument();
    expect(screen.queryByText("Died")).not.toBeInTheDocument();
  });

  test("dead life shows the Died badge, not Alive", () => {
    const d = dead();
    render(<LifeHero data={d} view={view(d)} />);
    expect(screen.getByText("Died")).toBeInTheDocument();
    expect(screen.queryByText("Alive")).not.toBeInTheDocument();
  });

  test("renders all five stats", () => {
    const d = alive();
    render(<LifeHero data={d} view={view(d)} />);
    expect(screen.getByText("Time alive")).toBeInTheDocument();
    expect(screen.getByText("Kills")).toBeInTheDocument();
    expect(screen.getByText("Longest kill")).toBeInTheDocument();
    expect(screen.getByText("Sessions")).toBeInTheDocument();
    expect(screen.getAllByText("Qualified").length).toBeGreaterThan(0);
  });

  test("Qualified stat: glyph is decorative, value has an sr-only text equivalent", () => {
    const d = alive();
    const { container } = render(<LifeHero data={d} view={view(d)} />);
    const glyph = screen.getByText("✓");
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    const srText = container.querySelector(".sr-only");
    expect(srText).toHaveTextContent("Qualified");
    expect(srText!.parentElement).toHaveAccessibleName("Qualified");
  });

  test("Qualified stat: unqualified life reads 'Not qualified' for AT, dash is decorative", () => {
    const d = data({ qualifiedAt: null });
    const { container } = render(<LifeHero data={d} view={view(d)} />);
    const glyph = screen.getByText("—", { selector: "[aria-hidden]" });
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    const srText = container.querySelector(".sr-only");
    expect(srText).toHaveTextContent("Not qualified");
    expect(srText!.parentElement).toHaveAccessibleName("Not qualified");
  });

  test("portrait renders an img when avatarHash is present, and omits it when null", () => {
    const withAvatar = data({ avatarHash: "cafe1234feed5678" });
    const { container: withImg } = render(<LifeHero data={withAvatar} view={view(withAvatar)} />);
    const img = withImg.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "/api/avatars/cafe1234feed5678.webp");

    const withoutAvatar = data();
    const { container: noImg } = render(<LifeHero data={withoutAvatar} view={view(withoutAvatar)} />);
    expect(noImg.querySelector("img")).toBeNull();
  });

  test("links the published obituary when the timeline carries a slug", () => {
    const d = data({ obituarySlug: "the-end-abc-1-4" });
    render(<LifeHero data={d} view={view(d)} />);
    const link = screen.getByRole("link", { name: /read the obituary/i });
    expect(link).toHaveAttribute("href", "/obituaries/the-end-abc-1-4");
  });

  test("renders no obituary link when the slug is null", () => {
    const d = data({ obituarySlug: null });
    render(<LifeHero data={d} view={view(d)} />);
    expect(screen.queryByRole("link", { name: /read the obituary/i })).toBeNull();
  });

  test("uses dark-stage tokens", () => {
    const { container } = render(<LifeHero data={dead()} view={view(dead())} />);
    const section = container.querySelector("section")!;
    expect(section.className).toContain("bg-dark");
    expect(section.className).toContain("border-red");
  });
});
