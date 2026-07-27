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
  avatarHash: null,
};

const pageOf = (rows: typeof row[], total = rows.length): SurvivorsPage =>
  ({ rows, total, page: 1, pageSize: 25 });

describe("SurvivorsBoard", () => {
  // ⚠️ Always map-scoped: there is no combined board, so there is no board without a map name.
  test("the h1 names the map", () => {
    render(<SurvivorsBoard page={pageOf([row])} slug="sakhal" tabs={[]} />);
    expect(screen.getByRole("heading", { level: 1, name: "Sakhal survivors" })).toBeInTheDocument();
  });

  test("an unknown slug title-cases rather than showing a raw slug", () => {
    render(<SurvivorsBoard page={pageOf([row])} slug="livonia" tabs={[]} />);
    expect(screen.getByRole("heading", { level: 1, name: "Livonia survivors" })).toBeInTheDocument();
  });

  test("shows the dek line", () => {
    render(<SurvivorsBoard page={pageOf([row])} slug="chernarus" tabs={[]} />);
    expect(
      screen.getByText(/still drawing breath\. Every name is one bad decision from the archive\./)
    ).toBeInTheDocument();
  });

  test("empty board shows the quiet-coast line", () => {
    render(<SurvivorsBoard page={pageOf([], 0)} slug="sakhal" tabs={[]} />);
    expect(screen.getByText(/The coast is quiet\. No qualified survivors on record\./i)).toBeInTheDocument();
  });

  test("renders a row for each survivor", () => {
    render(<SurvivorsBoard page={pageOf([row])} slug="chernarus" tabs={[]} />);
    expect(screen.getByText("Chad")).toBeInTheDocument();
  });

  // The map is in the heading and the tabs; repeating it on every row would be noise.
  test("does not repeat the map on each row", () => {
    render(<SurvivorsBoard page={pageOf([row])} slug="chernarus" tabs={[]} />);
    expect(screen.queryByText("chernarus")).not.toBeInTheDocument();
  });
});
