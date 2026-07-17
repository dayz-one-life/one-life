import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { PastLifeCard } from "./past-life-card";
import type { PastLife } from "@/lib/types";

const now = new Date("2026-07-16T12:00:00Z");

function life(overrides: Partial<PastLife> = {}): PastLife {
  return {
    lifeId: 9, serverId: 1, map: "sakhal", slug: "sakhal", lifeNumber: 2,
    startedAt: "2026-07-14T04:00:00Z", endedAt: "2026-07-14T09:06:00Z",
    timeAliveSeconds: 18360, kills: 0, longestKillMeters: null, character: null,
    death: { cause: "pvp", byGamertag: "TidierCart8730", weapon: "VSD", distanceMeters: 126 },
    vitals: { energy: null, water: null, bleedSources: null },
    sessions: 9, killList: [],
    ...overrides,
  };
}

describe("PastLifeCard", () => {
  test("funeral card: map, dateline, pvp death line, counts strip", () => {
    render(<PastLifeCard life={life()} now={now} />);
    expect(screen.getByText("Sakhal")).toBeInTheDocument();
    expect(screen.getByText("2 days ago · lasted 5h 6m")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "TidierCart8730" })).toHaveAttribute("href", "/players/tidiercart8730");
    expect(screen.getByText(/VSD · 126m/)).toBeInTheDocument();
    expect(screen.getByText("0 kills")).toBeInTheDocument();
    expect(screen.getByText("— longest kill")).toBeInTheDocument();
    expect(screen.getByText("9 sessions")).toBeInTheDocument();
  });

  test("environment death line has no link", () => {
    render(<PastLifeCard life={life({ death: { cause: "environment", byGamertag: null, weapon: null, distanceMeters: null } })} now={now} />);
    expect(screen.getByText(/Died — environment/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  test("no kill list or vitals render", () => {
    render(<PastLifeCard life={life({ killList: [{ victimGamertag: "X", weapon: null, distanceMeters: null, occurredAt: "2026-07-14T05:00:00Z" }], vitals: { energy: 100, water: 50, bleedSources: 1 } })} now={now} />);
    expect(screen.queryByText(/Kills this life/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/At death/i)).not.toBeInTheDocument();
  });

  test("singular session", () => {
    render(<PastLifeCard life={life({ sessions: 1 })} now={now} />);
    expect(screen.getByText("1 session")).toBeInTheDocument();
  });

  test("singular kill", () => {
    render(<PastLifeCard life={life({ kills: 1 })} now={now} />);
    expect(screen.getByText("1 kill")).toBeInTheDocument();
  });
});
