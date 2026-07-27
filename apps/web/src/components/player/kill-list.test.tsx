import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { KillList } from "./kill-list";

describe("KillList", () => {
  it("renders victim links with weapon and distance", () => {
    render(<KillList kills={[{ victimGamertag: "Tomahawked11", weapon: "VSS", distanceMeters: 5, occurredAt: "2026-07-12T01:00:00Z" }]} />);
    const link = screen.getByRole("link", { name: "Tomahawked11" });
    expect(link).toHaveAttribute("href", "/players/tomahawked11");
    // The distance is now wrapped in its own span (rule #9), splitting this line across
    // elements — assert the row's full text rather than a single text node.
    expect(link.closest("li")).toHaveTextContent("VSS · 5 m");
  });

  it("the distance value is exempt from the row's uppercase (#9)", () => {
    render(<KillList kills={[{ victimGamertag: "Tomahawked11", weapon: "VSS", distanceMeters: 5, occurredAt: "2026-07-12T01:00:00Z" }]} />);
    const value = screen.getByText("5 m");
    expect(value.className).toContain("normal-case");
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
