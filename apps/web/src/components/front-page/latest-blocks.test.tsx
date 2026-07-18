import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import type { ObituaryCard, BirthNoticeCard } from "@/lib/types";
import { LatestObituaries } from "./latest-obituaries";
import { LatestFreshSpawns } from "./latest-fresh-spawns";

const obit: ObituaryCard = {
  slug: "gone-42", gamertag: "Boots", map: "chernarusplus", mapSlug: "chernarus", lifeNumber: 3,
  headline: "The King Is Dead", lede: "L", tags: ["Obituaries"], timeAliveSeconds: 7200, kills: 3,
  longestKillMeters: 210, cause: "pvp", deathAt: "2026-07-10T00:00:00Z",
};

const spawn: BirthNoticeCard = {
  slug: "new-fool-1", gamertag: "Khushie", map: "sakhal", mapSlug: "sakhal", lifeNumber: 1,
  headline: "Another Fool Washes Ashore", lede: "L", tags: ["Fresh Spawns"],
  bornAt: "2026-07-17T10:00:00Z", minutesToQualify: 6, priorLives: 0,
};

describe("LatestObituaries", () => {
  it("renders headlines linking to interiors and an ALL link to the section", () => {
    render(<LatestObituaries rows={[obit]} />);
    expect(screen.getByRole("link", { name: /The King Is Dead/ })).toHaveAttribute("href", "/obituaries/gone-42");
    expect(screen.getByRole("link", { name: "ALL →" })).toHaveAttribute("href", "/obituaries");
  });
  it("shows a quiet empty state when there are no rows", () => {
    render(<LatestObituaries rows={[]} />);
    expect(screen.getByText(/NOTHING FILED YET/)).toBeInTheDocument();
  });
});

describe("LatestFreshSpawns", () => {
  it("renders headlines linking to interiors and an ALL link to the section", () => {
    render(<LatestFreshSpawns rows={[spawn]} />);
    expect(screen.getByRole("link", { name: /Another Fool Washes Ashore/ })).toHaveAttribute("href", "/fresh-spawns/new-fool-1");
    expect(screen.getByRole("link", { name: "ALL →" })).toHaveAttribute("href", "/fresh-spawns");
  });
  it("shows a quiet empty state when there are no rows", () => {
    render(<LatestFreshSpawns rows={[]} />);
    expect(screen.getByText(/NO FOOL HAS WASHED ASHORE YET/)).toBeInTheDocument();
  });
});
