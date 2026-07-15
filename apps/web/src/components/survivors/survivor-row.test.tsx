import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { SurvivorRow } from "./survivor-row";

const base = {
  gamertag: "Chad",
  map: "chernarusplus",
  slug: "chernarus",
  timeAliveSeconds: 24180,
  killsThisLife: 11,
  longestKillMeters: 341,
  character: { name: "Boris", head: "m_boris", gender: "male" as const },
};

describe("SurvivorRow", () => {
  test("kills sort shows only the Kills stat, with gamertag, map badge, and avatar", () => {
    render(<SurvivorRow rank={1} showMap sort="kills" row={base} />);
    expect(screen.getByText("Chad")).toBeInTheDocument();
    expect(screen.getByText("Kills")).toBeInTheDocument();
    expect(screen.getByText("11")).toBeInTheDocument();
    // other stats hidden
    expect(screen.queryByText("Time alive")).not.toBeInTheDocument();
    expect(screen.queryByText("Longest kill")).not.toBeInTheDocument();
    expect(screen.getByText(/chernarus/i)).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("src", "/characters/boris.webp");
  });

  test("time sort shows only the Time alive stat", () => {
    render(<SurvivorRow rank={1} showMap={false} sort="time" row={base} />);
    expect(screen.getByText("Time alive")).toBeInTheDocument();
    expect(screen.getByText("6h 43m")).toBeInTheDocument();
    expect(screen.queryByText("Kills")).not.toBeInTheDocument();
  });

  test("longest sort shows the Longest kill stat and a dash for a null value", () => {
    render(
      <SurvivorRow
        rank={2}
        showMap={false}
        sort="longest"
        row={{ ...base, gamertag: "Pacifist", longestKillMeters: null, character: null }}
      />
    );
    expect(screen.getByText("Longest kill")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  test("renders an inline silhouette fallback (no broken img) when character is null", () => {
    render(
      <SurvivorRow
        rank={3}
        showMap={false}
        sort="time"
        row={{ ...base, character: null }}
      />
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/unknown survivor/i)).toBeInTheDocument();
  });

  test("hides the map badge when showMap is false", () => {
    render(<SurvivorRow rank={2} showMap={false} sort="kills" row={base} />);
    expect(screen.queryByText(/chernarus/i)).not.toBeInTheDocument();
  });

  test("links the gamertag to the player page", () => {
    render(<SurvivorRow row={{ ...base, gamertag: "xSgt Hartman" }} rank={1} showMap={false} sort="time" />);
    expect(screen.getByRole("link", { name: "xSgt Hartman" })).toHaveAttribute("href", "/players/xsgt-hartman");
  });
});
