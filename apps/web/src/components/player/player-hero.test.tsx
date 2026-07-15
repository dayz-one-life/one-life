import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { PlayerHero } from "./player-hero";

const base: any = { gamertag: "yrjustbad", verified: true, firstSeenAt: "2026-03-09T00:00:00Z", aliveAnywhere: false, standing: [], totals: { kills: 42, lives: 7, deaths: 6, longestLifeSeconds: 64800 } };

describe("PlayerHero", () => {
  it("renders the gamertag and no character avatar", () => {
    const { container } = render(<PlayerHero page={base} />);
    expect(screen.getByRole("heading", { name: "yrjustbad" })).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull(); // no avatar image
  });
  it("shows the stat band and drops Kills when 0", () => {
    render(<PlayerHero page={{ ...base, totals: { ...base.totals, kills: 0 } }} />);
    expect(screen.queryByText("Kills")).toBeNull();
    expect(screen.getByText("Longest life")).toBeInTheDocument();
  });
});
