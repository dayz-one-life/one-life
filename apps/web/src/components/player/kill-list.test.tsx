import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { KillList } from "./kill-list";

describe("KillList", () => {
  it("renders victim links with weapon and distance", () => {
    render(<KillList kills={[{ victimGamertag: "Tomahawked11", weapon: "VSS", distanceMeters: 5, occurredAt: "2026-07-12T01:00:00Z", basis: "kill_line" as const }]} />);
    const link = screen.getByRole("link", { name: "Tomahawked11" });
    expect(link).toHaveAttribute("href", "/players/tomahawked11");
    // The distance is now wrapped in its own span (rule #9), splitting this line across
    // elements — assert the row's full text rather than a single text node.
    expect(link.closest("li")).toHaveTextContent("VSS · 5 m");
  });

  it("the distance value is exempt from the row's uppercase (#9)", () => {
    render(<KillList kills={[{ victimGamertag: "Tomahawked11", weapon: "VSS", distanceMeters: 5, occurredAt: "2026-07-12T01:00:00Z", basis: "kill_line" as const }]} />);
    const value = screen.getByText("5 m");
    expect(value.className).toContain("normal-case");
  });

  it("a trap row is marked \"by trap\" and the list carries the footnote", () => {
    render(<KillList kills={[
      { victimGamertag: "Victim One", weapon: "Tripwire", distanceMeters: null, occurredAt: "2026-07-12T02:00:00Z", basis: "trap_placement" },
      { victimGamertag: "Victim Two", weapon: "VSS", distanceMeters: 5, occurredAt: "2026-07-12T01:00:00Z", basis: "kill_line" },
    ]} />);
    expect(screen.getByRole("link", { name: "Victim One" }).closest("li")).toHaveTextContent("Victim One" + "Tripwire · by trap");
    expect(screen.getByRole("link", { name: "Victim Two" }).closest("li")).not.toHaveTextContent("by trap");
    expect(screen.getByText("By trap: credited from where the trap was placed. The log names no killer.")).toBeInTheDocument();
  });

  it("a list with no trap row has no footnote", () => {
    render(<KillList kills={[{ victimGamertag: "Victim Two", weapon: "VSS", distanceMeters: 5, occurredAt: "2026-07-12T01:00:00Z", basis: "kill_line" }]} />);
    expect(screen.queryByText(/By trap:/)).not.toBeInTheDocument();
  });

  it("a trap row hidden in the collapsed tail brings no footnote: it explains only rows on screen", () => {
    const kills = Array.from({ length: 3 }, (_, i) => ({
      victimGamertag: `V${i}`, weapon: i === 2 ? "Land mine" : "VSS", distanceMeters: null, occurredAt: "2026-07-12T01:00:00Z",
      basis: (i === 2 ? "trap_placement" : "kill_line") as "trap_placement" | "kill_line",
    }));
    render(<KillList kills={kills} limit={2} />);
    expect(screen.queryByText(/By trap:/)).not.toBeInTheDocument();
  });

  it("empty list renders the pacifist line", () => {
    render(<KillList kills={[]} />);
    expect(screen.getByText("None yet. The pacifist era.")).toBeInTheDocument();
  });

  it("limit collapses the tail", () => {
    const kills = Array.from({ length: 12 }, (_, i) => ({
      victimGamertag: `V${i}`,
      weapon: null,
      distanceMeters: null,
      occurredAt: "2026-07-12T01:00:00Z",
      basis: "kill_line" as const,
    }));
    render(<KillList kills={kills} limit={10} />);
    expect(screen.getByText("+ 2 more")).toBeInTheDocument();
    for (let i = 0; i < 10; i++) {
      expect(screen.getByText(`V${i}`)).toBeInTheDocument();
    }
    expect(screen.queryByText("V10")).not.toBeInTheDocument();
    expect(screen.queryByText("V11")).not.toBeInTheDocument();
  });
});
