import { render, screen } from "@testing-library/react";
import { it, expect } from "vitest";
import { Footer } from "./footer";

it("renders the colophon line on the dark bar", () => {
  render(<Footer />);
  const footer = screen.getByRole("contentinfo");
  expect(footer.className).toContain("bg-dark");
  expect(footer).toHaveTextContent("One Life — hardcore · 1PP · US servers");
});

// The TabBar carries Home/Map/Board/account; About is reachable ONLY here below md, so this
// link is the mobile route to it, not decoration.
it("carries the About link, which the tab bar does not", () => {
  render(<Footer />);
  expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
});

it("links to the obituaries feed", () => {
  render(<Footer />);
  expect(screen.getByRole("link", { name: "Obituaries" })).toHaveAttribute("href", "/obituaries");
});

// ⚠️ Regression guard. The footer is the last in-flow element in the document, so it — not the
// content column — must reserve space for the fixed TabBar. Without this the bar paints directly
// over the About link at the bottom of every page, and About has no other route below `md`.
// jsdom cannot see the overlap, so the contract is pinned as a class.
it("reserves bottom space for the fixed tab bar below md, and drops it at md", () => {
  render(<Footer />);
  const footer = screen.getByRole("contentinfo");
  expect(footer.className).toMatch(/pb-\[calc\(18px\+4rem\+env\(safe-area-inset-bottom\)\)\]/);
  expect(footer.className).toMatch(/md:pb-\[18px\]/);
});
