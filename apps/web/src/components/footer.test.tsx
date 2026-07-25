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
