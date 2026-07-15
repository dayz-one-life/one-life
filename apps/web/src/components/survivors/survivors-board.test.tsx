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

  test("shows map badges only on the combined board", () => {
    const page: SurvivorsPage = { rows: [row], total: 1, page: 1, pageSize: 25, sort: "kills" };
    const { rerender } = render(<SurvivorsBoard page={page} slug={null} tabs={[]} />);
    // combined board -> per-row map badge present
    expect(screen.getByTestId("row-map-badge")).toBeInTheDocument();

    rerender(<SurvivorsBoard page={page} slug="chernarus" tabs={[]} />);
    // single-map board -> no per-row badge
    expect(screen.queryByTestId("row-map-badge")).not.toBeInTheDocument();
  });
});
