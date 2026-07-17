import { render, screen } from "@testing-library/react";
import { it, expect } from "vitest";
import { TeaserPage } from "./teaser-page";

it("renders kicker, screamer, line, and the survivors escape hatch", () => {
  render(<TeaserPage kicker="Obituaries" title="The morgue desk is hiring." line="DEVELOPING." />);
  expect(screen.getByText("Obituaries")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "The morgue desk is hiring." })).toBeInTheDocument();
  expect(screen.getByText("DEVELOPING.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Meanwhile, the living are ranked →" })).toHaveAttribute("href", "/survivors");
});
