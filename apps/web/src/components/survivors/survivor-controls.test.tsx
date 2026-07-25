import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { SurvivorControls } from "./survivor-controls";

const TABS = [
  { slug: "chernarus", label: "Chernarus" },
  { slug: "sakhal", label: "Sakhal" },
];

describe("SurvivorControls", () => {
  test("each tab links to its board at page 1", () => {
    render(<SurvivorControls slug="chernarus" tabs={TABS} />);
    expect(screen.getByRole("link", { name: "Sakhal" })).toHaveAttribute("href", "/survivors/sakhal");
    expect(screen.getByRole("link", { name: "Chernarus" })).toHaveAttribute("href", "/survivors/chernarus");
  });

  test("the current map is aria-current and the others are not", () => {
    render(<SurvivorControls slug="chernarus" tabs={TABS} />);
    expect(screen.getByRole("link", { name: "Chernarus" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Sakhal" })).not.toHaveAttribute("aria-current");
  });

  test("active tab is solid ink; inactive is outlined", () => {
    render(<SurvivorControls slug="chernarus" tabs={TABS} />);
    expect(screen.getByRole("link", { name: "Chernarus" }).className).toContain("bg-ink");
    const sakhal = screen.getByRole("link", { name: "Sakhal" });
    expect(sakhal.className).toContain("border-ink");
    expect(sakhal.className).not.toContain(" bg-ink");
  });

  // ⚠️ The sort pills and the "All maps" tab are gone with the sort layer and the combined board
  // (sub-project D). Every link here is a map board.
  test("renders no sort pills", () => {
    render(<SurvivorControls slug="chernarus" tabs={TABS} />);
    for (const label of [/time alive/i, /^kills$/i, /longest kill/i]) {
      expect(screen.queryByRole("link", { name: label })).toBeNull();
    }
  });

  test("renders no All maps tab, and no link escapes to a bare /survivors", () => {
    render(<SurvivorControls slug="chernarus" tabs={TABS} />);
    expect(screen.queryByRole("link", { name: "All maps" })).toBeNull();
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href")).toMatch(/^\/survivors\/[^/]+$/);
    }
  });

  test("scales past the current fleet", () => {
    render(<SurvivorControls slug="chernarus" tabs={[...TABS, { slug: "badlands", label: "Badlands" }]} />);
    expect(screen.getByRole("link", { name: "Badlands" })).toHaveAttribute("href", "/survivors/badlands");
  });
});
