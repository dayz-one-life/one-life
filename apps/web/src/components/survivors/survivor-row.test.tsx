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
  // Portraits are decorative (alt="") so they have no img role — query the DOM directly.
  test("hero row (rank 1) shows portrait, stat label, and kills sub-line under time sort", () => {
    const { container } = render(<SurvivorRow rank={1} showMap sort="time" row={base} />);
    const img = container.querySelector("img")!;
    expect(img).toHaveAttribute("src", "/characters/boris.webp");
    expect(img).toHaveAttribute("width", "76");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(screen.getByText("Time alive")).toBeInTheDocument();
    expect(screen.getByText("6h 43m")).toBeInTheDocument();
    expect(screen.getByText("chernarus · 11 kills")).toBeInTheDocument();
  });

  test("hero row omits the kills suffix when sorting by kills", () => {
    render(<SurvivorRow rank={1} showMap sort="kills" row={base} />);
    expect(screen.getByText("chernarus")).toBeInTheDocument();
    expect(screen.queryByText(/11 kills/)).not.toBeInTheDocument();
    expect(screen.getByText("11")).toBeInTheDocument(); // the stat itself
  });

  test("podium row (rank 2) has a 60px portrait and no stat label", () => {
    const { container } = render(<SurvivorRow rank={2} showMap={false} sort="time" row={base} />);
    const img = container.querySelector("img")!;
    expect(img).toHaveAttribute("width", "60");
    expect(screen.queryByText("Time alive")).not.toBeInTheDocument();
    expect(screen.getByText("6h 43m")).toBeInTheDocument();
  });

  test("compact row (rank 4) has no portrait and inline map", () => {
    const { container } = render(<SurvivorRow rank={4} showMap sort="longest" row={base} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("chernarus")).toBeInTheDocument();
    expect(screen.getByText("341m")).toBeInTheDocument();
  });

  test("null longest kill renders an em dash", () => {
    render(<SurvivorRow rank={5} showMap={false} sort="longest" row={{ ...base, longestKillMeters: null }} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  test("unknown character renders no img (silhouette fallback is decorative)", () => {
    const { container } = render(<SurvivorRow rank={1} showMap={false} sort="time" row={{ ...base, character: null }} />);
    expect(container.querySelector("img")).toBeNull();
  });

  test("gamertag links to the player page", () => {
    render(<SurvivorRow rank={3} showMap={false} sort="time" row={base} />);
    expect(screen.getByRole("link", { name: "Chad" })).toHaveAttribute("href", "/players/chad");
  });
});
