import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import type { ObituaryCard } from "@/lib/types";
import { Fallen } from "./fallen";
import { Rules } from "./rules";

const obit = (over: Partial<ObituaryCard>): ObituaryCard => ({
  slug: "yrjustbad-life-3", gamertag: "YrJustBad", map: "chernarusplus", mapSlug: "chernarus",
  lifeNumber: 3, headline: "Shot in the back on the Topolka dam", lede: "He had outlasted forty-one others.",
  tags: [], timeAliveSeconds: 112320, kills: 4, longestKillMeters: 210, cause: "pvp",
  deathAt: "2026-07-27T20:00:00Z", ...over,
});

describe("Fallen", () => {
  it("renders up to three obituary cards linking to their articles", () => {
    render(<Fallen rows={[obit({}), obit({ slug: "b", gamertag: "Khushie" }), obit({ slug: "c", gamertag: "Un4givn" }), obit({ slug: "d", gamertag: "Fourth" })]} />);
    expect(screen.getByRole("heading", { name: /The Fallen/i })).toBeInTheDocument();
    const cards = screen.getAllByRole("link", { name: /Shot in the back/ });
    expect(cards).toHaveLength(3); // capped at 3
    expect(cards[0]).toHaveAttribute("href", "/obituaries/yrjustbad-life-3");
    expect(screen.getByRole("link", { name: "All obituaries →" })).toHaveAttribute("href", "/obituaries");
    // Meta line: callsign + honest duration + map label.
    expect(screen.getByText("YrJustBad")).toBeInTheDocument();
    // all three shown cards share the fixture's default duration, so assert at least one instance
    expect(screen.getAllByText(/31h 12m survived/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Obituary · Chernarus/i).length).toBeGreaterThan(0);
  });

  it("renders NOTHING when there are no rows — absent proof is silence, never an empty shell", () => {
    const { container } = render(<Fallen rows={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Rules", () => {
  it("renders the three rules", () => {
    render(<Rules />);
    expect(screen.getByText("One life")).toBeInTheDocument();
    expect(screen.getByText("Death is real")).toBeInTheDocument();
    expect(screen.getByText("Earn your way back")).toBeInTheDocument();
  });
});
