import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { SurvivorsBoard } from "./survivors-board";
import type { SurvivorsPage } from "@/lib/types";

const row = {
  gamertag: "Chad",
  map: "chernarusplus",
  slug: "chernarus",
  timeAliveSeconds: 3600,
  killsThisLife: 3,
  longestKillMeters: 200,
  character: null,
};

describe("SurvivorsBoard", () => {
  test("renders rows and an empty state", () => {
    const empty: SurvivorsPage = { rows: [], total: 0, page: 1, pageSize: 25, sort: "kills" };
    render(<SurvivorsBoard page={empty} slug="sakhal" tabs={[]} />);
    expect(screen.getByText(/no survivors/i)).toBeInTheDocument();
  });

  test("renders a row for each survivor", () => {
    const page: SurvivorsPage = { rows: [row], total: 1, page: 1, pageSize: 25, sort: "kills" };
    render(<SurvivorsBoard page={page} slug={null} tabs={[]} />);
    expect(screen.getByText("Chad")).toBeInTheDocument();
  });

  test("shows the per-row map only on the combined board", () => {
    const page: SurvivorsPage = { rows: [row], total: 1, page: 1, pageSize: 25, sort: "kills" };
    const { rerender } = render(<SurvivorsBoard page={page} slug={null} tabs={[]} />);
    // combined board -> per-row map shown
    expect(screen.getByText("chernarus")).toBeInTheDocument();

    rerender(<SurvivorsBoard page={page} slug="chernarus" tabs={[]} />);
    // single-map board -> no per-row map text
    expect(screen.queryByText("chernarus")).not.toBeInTheDocument();
  });

  test("renders an SEO H1 for a single map + sort", () => {
    const page: SurvivorsPage = { rows: [row], total: 1, page: 1, pageSize: 25, sort: "kills" };
    render(<SurvivorsBoard page={page} slug="sakhal" tabs={[]} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Top Sakhal survivors by kills");
  });

  test("combined board H1 drops the map name and uses time-alive by default", () => {
    const page: SurvivorsPage = { rows: [row], total: 1, page: 1, pageSize: 25, sort: "time" };
    render(<SurvivorsBoard page={page} slug={null} tabs={[]} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Top survivors by time alive");
  });

  test("longest sort H1 reads 'longest kill'", () => {
    const page: SurvivorsPage = { rows: [row], total: 1, page: 1, pageSize: 25, sort: "longest" };
    render(<SurvivorsBoard page={page} slug="chernarus" tabs={[]} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Top Chernarus survivors by longest kill");
  });
});
