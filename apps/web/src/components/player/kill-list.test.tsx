import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { KillList } from "./kill-list";

describe("KillList", () => {
  it("renders victim links with weapon and distance", () => {
    render(<KillList kills={[{ victimGamertag: "Tomahawked11", weapon: "VSS", distanceMeters: 5, occurredAt: "2026-07-12T01:00:00Z" }]} />);
    expect(screen.getByRole("link", { name: "Tomahawked11" })).toHaveAttribute("href", "/players/tomahawked11");
    expect(screen.getByText("VSS · 5m")).toBeInTheDocument();
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
