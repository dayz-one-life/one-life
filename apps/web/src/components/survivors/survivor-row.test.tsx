import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { SurvivorRow } from "./survivor-row";

describe("SurvivorRow", () => {
  test("renders gamertag, formatted stats, and map badge when showMap", () => {
    render(
      <SurvivorRow
        rank={1}
        showMap
        row={{
          gamertag: "Chad",
          map: "chernarusplus",
          slug: "chernarus",
          timeAliveSeconds: 24180,
          killsThisLife: 11,
          longestKillMeters: 341,
          character: { name: "Boris", head: "m_boris", gender: "male" },
        }}
      />
    );
    expect(screen.getByText("Chad")).toBeInTheDocument();
    expect(screen.getByText("11")).toBeInTheDocument();
    expect(screen.getByText("341m")).toBeInTheDocument();
    expect(screen.getByText(/chernarus/i)).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("src", "/characters/boris.webp");
  });

  test("hides map badge when showMap is false and shows dash for null longest kill", () => {
    render(
      <SurvivorRow
        rank={2}
        showMap={false}
        row={{
          gamertag: "Pacifist",
          map: "sakhal",
          slug: "sakhal",
          timeAliveSeconds: 3600,
          killsThisLife: 0,
          longestKillMeters: null,
          character: null,
        }}
      />
    );
    expect(screen.queryByText(/sakhal/i)).not.toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  test("renders an inline silhouette fallback (no broken img) when character is null", () => {
    render(
      <SurvivorRow
        rank={3}
        showMap={false}
        row={{
          gamertag: "Nobody",
          map: "sakhal",
          slug: "sakhal",
          timeAliveSeconds: 60,
          killsThisLife: 0,
          longestKillMeters: null,
          character: null,
        }}
      />
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/unknown survivor/i)).toBeInTheDocument();
  });
});
