import { render, screen } from "@testing-library/react";
import { it, expect } from "vitest";
import { Footer } from "./footer";

it("renders the colophon line on the dark bar", () => {
  render(<Footer />);
  const footer = screen.getByRole("contentinfo");
  expect(footer.className).toContain("bg-dark");
  expect(footer).toHaveTextContent("One Life — hardcore · 1PP · US servers");
});

// About, Terms and Privacy are reached from here and from the sign-in consent line. About is
// also in the nav menu; Terms and Privacy are footer-only by design — nobody navigates to them.
it("carries the About link", () => {
  render(<Footer />);
  expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
});

it("links to the obituaries feed", () => {
  render(<Footer />);
  expect(screen.getByRole("link", { name: "Obituaries" })).toHaveAttribute("href", "/obituaries");
});

// ⚠️ Regression guard, narrowed. The fixed tab bar is gone, so the 4rem it reserved goes with
// it — but the safe-area inset stays: that is the phone's home indicator, not the bar. The
// footer is the last in-flow element in the document, so the inset belongs here and not on the
// content column. jsdom cannot see the overlap, so the contract is pinned as a class.
it("reserves only the safe-area inset at the bottom — the tab bar is gone", () => {
  render(<Footer />);
  const footer = screen.getByRole("contentinfo");
  expect(footer.className).toMatch(/pb-\[calc\(18px\+env\(safe-area-inset-bottom\)\)\]/);
  expect(footer.className).not.toMatch(/4rem/);
  expect(footer.className).not.toMatch(/md:pb-/);
});

it("links to the legal pages", () => {
  render(<Footer />);
  expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
});

// ⚠️ Four links do not fit one line in a 320px column. jsdom cannot measure that, so the wrap
// contract is pinned as a class on the link row — the on-device check is a separate item.
it("lets the link row wrap rather than overflow a narrow column", () => {
  render(<Footer />);
  const nav = screen.getByRole("navigation", { name: /site information/i });
  expect(nav.className).toContain("flex-wrap");
});
