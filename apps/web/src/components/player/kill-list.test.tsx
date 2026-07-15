import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { KillList } from "./kill-list";
import type { PlayerKill } from "@/lib/types";

function makeKills(count: number): PlayerKill[] {
  return Array.from({ length: count }, (_, i) => ({
    victimGamertag: `Victim${i}`,
    weapon: "Mosin",
    distanceMeters: 100 + i,
    occurredAt: "2026-07-12T01:00:00Z",
  }));
}

describe("KillList", () => {
  it("renders the empty state when there are no kills", () => {
    render(<KillList kills={[]} />);
    expect(screen.getByText("No kills this life.")).toBeInTheDocument();
  });

  it("truncates to the limit and shows a + N more count", () => {
    const kills = makeKills(12);
    render(<KillList kills={kills} limit={10} />);
    expect(screen.getByText("+ 2 more")).toBeInTheDocument();
    for (let i = 0; i < 10; i++) {
      expect(screen.getByText(`Victim${i}`)).toBeInTheDocument();
    }
    expect(screen.queryByText("Victim10")).not.toBeInTheDocument();
    expect(screen.queryByText("Victim11")).not.toBeInTheDocument();
  });
});
