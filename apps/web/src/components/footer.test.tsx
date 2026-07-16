import { render, screen } from "@testing-library/react";
import { it, expect } from "vitest";
import { Footer } from "./footer";

it("renders the paper's colophon line on the dark bar", () => {
  render(<Footer />);
  const footer = screen.getByRole("contentinfo");
  expect(footer.className).toContain("bg-dark");
  expect(footer).toHaveTextContent(
    "One Life — a chronicle of the living and the dead. · Hardcore · 1PP · US servers",
  );
});
