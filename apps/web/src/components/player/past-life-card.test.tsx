import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { PastLifeCard } from "./past-life-card";
import type { PastLife } from "@/lib/types";

const now = new Date("2026-07-16T12:00:00Z");

function life(overrides: Partial<PastLife> = {}): PastLife {
  return {
    lifeId: 9, serverId: 1, map: "sakhal", slug: "sakhal", lifeNumber: 2,
    startedAt: "2026-07-14T04:00:00Z", endedAt: "2026-07-14T09:06:00Z",
    timeAliveSeconds: 18360, kills: 0, longestKillMeters: null,
    death: { cause: "pvp", byGamertag: "TidierCart8730", weapon: "VSD", distanceMeters: 126, verdict: null },
    vitals: { energy: null, water: null, bleedSources: null },
    sessions: 9, killList: [],
    ...overrides,
  };
}

describe("PastLifeCard", () => {
  test("funeral card: map, dateline, pvp death line, counts strip", () => {
    render(<PastLifeCard life={life()} now={now} gamertag="YrJustBad" />);
    const heading = screen.getByRole("heading", { level: 3, name: "Sakhal" });
    expect(heading).toBeInTheDocument();
    // The duration is now wrapped in its own span (rule #9), splitting this line across
    // elements — assert the dateline's full text rather than a single text node.
    expect(heading.nextElementSibling).toHaveTextContent("2 days ago · lasted 5h 6m");
    const killerLink = screen.getByRole("link", { name: "TidierCart8730" });
    expect(killerLink).toHaveAttribute("href", "/players/tidiercart8730");
    expect(killerLink.closest("p")).toHaveTextContent("VSD · 126 m");
    expect(screen.getByText("0 kills")).toBeInTheDocument();
    expect(screen.getByText(/longest kill/, { exact: false })).toHaveTextContent("— longest kill");
    expect(screen.getByText("9 sessions")).toBeInTheDocument();
  });

  test("environment death line has no killer link", () => {
    render(<PastLifeCard life={life({ death: { cause: "environment", byGamertag: null, weapon: null, distanceMeters: null, verdict: null } })} now={now} gamertag="YrJustBad" />);
    expect(screen.getByText(/Died — Environment/i)).toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName(/timeline/i);
  });

  test("no kill list or vitals render", () => {
    render(<PastLifeCard life={life({ killList: [{ victimGamertag: "X", weapon: null, distanceMeters: null, occurredAt: "2026-07-14T05:00:00Z" }], vitals: { energy: 100, water: 50, bleedSources: 1 } })} now={now} gamertag="YrJustBad" />);
    expect(screen.queryByText(/Kills this life/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/At death/i)).not.toBeInTheDocument();
  });

  test("singular session", () => {
    render(<PastLifeCard life={life({ sessions: 1 })} now={now} gamertag="YrJustBad" />);
    expect(screen.getByText("1 session")).toBeInTheDocument();
  });

  test("singular kill", () => {
    render(<PastLifeCard life={life({ kills: 1 })} now={now} gamertag="YrJustBad" />);
    expect(screen.getByText("1 kill")).toBeInTheDocument();
  });

  test("pvp death with an unknown killer reads 'Killed by unknown'", () => {
    render(
      <PastLifeCard
        life={life({ death: { cause: "pvp", byGamertag: null, weapon: null, distanceMeters: null, verdict: null } })}
        now={now}
        gamertag="YrJustBad"
      />,
    );
    expect(screen.getByText(/Killed by\s*unknown/)).toBeInTheDocument();
  });

  test("named killer line pins the 'Killed by' prefix and singular kill count", () => {
    render(
      <PastLifeCard
        life={life({ kills: 1, death: { cause: "pvp", byGamertag: "YrJustBad", weapon: "VSS", distanceMeters: 5, verdict: null } })}
        now={now}
        gamertag="YrJustBad"
      />,
    );
    expect(screen.getByText(/Killed by/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "YrJustBad" })).toBeInTheDocument();
    expect(screen.getByText("1 kill")).toBeInTheDocument();
  });

  test("renders the map name as an h3 (player-profile.tsx nests cards under an h2 section)", () => {
    render(<PastLifeCard life={life()} now={now} gamertag="YrJustBad" />);
    expect(screen.getByRole("heading", { level: 3, name: "Sakhal" })).toBeInTheDocument();
  });

  test("links to the life timeline", () => {
    render(<PastLifeCard life={life()} now={now} gamertag="YrJustBad" />);
    expect(screen.getByRole("link", { name: /timeline/i })).toHaveAttribute("href", "/players/yrjustbad/sakhal/lives/2");
  });

  test("duration and distance values are exempt from the card's uppercase (#9)", () => {
    render(<PastLifeCard life={life()} now={now} gamertag="YrJustBad" />);
    expect(screen.getByText("5h 6m").className).toContain("normal-case");
    expect(screen.getByText("126 m").className).toContain("normal-case");
  });

  test("longest-kill metre value is exempt from the counts strip's uppercase (#9)", () => {
    render(<PastLifeCard life={life({ longestKillMeters: 375 })} now={now} gamertag="YrJustBad" />);
    expect(screen.getByText("375 m").className).toContain("normal-case");
  });

  test("non-pvp death line renders the classified verdict", () => {
    render(
      <PastLifeCard
        life={life({ death: { cause: "died", byGamertag: null, weapon: null, distanceMeters: null, verdict: { cause: "mauled", confidence: "high", conditions: ["bleeding", "hunted"] } } })}
        now={now}
        gamertag="YrJustBad"
      />,
    );
    expect(screen.getByText(/Died — Mauled/i)).toBeInTheDocument();
  });
});
