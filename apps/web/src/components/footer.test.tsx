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

// The four community links. Every assertion below is by ACCESSIBLE NAME, not by href or by
// position: the anchors' only child is an aria-hidden <svg>, so without the aria-label each one
// has no accessible name at all and a screen reader announces four unnamed links. Looking them
// up by name is what makes that regression fail here instead of shipping.
const SOCIAL: ReadonlyArray<[string, string]> = [
  ["Facebook", "https://www.facebook.com/profile.php?id=61591632406315"],
  ["Discord", "https://discord.gg/gdCdgmjhRe"],
  ["Reddit", "https://www.reddit.com/r/dayzonelife/"],
  ["X", "https://x.com/onelifexbox"],
];

it.each(SOCIAL)("links to %s off-site", (name, href) => {
  render(<Footer />);
  const link = screen.getByRole("link", { name });
  expect(link).toHaveAttribute("href", href);
  // Both halves matter: target opens the tab, rel keeps the opened page from reaching back
  // through window.opener.
  expect(link).toHaveAttribute("target", "_blank");
  expect(link.getAttribute("rel")).toContain("noopener");
});

it("hides the brand glyphs from assistive tech", () => {
  const { container } = render(<Footer />);
  const svgs = container.querySelectorAll("svg");
  expect(svgs).toHaveLength(SOCIAL.length);
  for (const svg of svgs) expect(svg).toHaveAttribute("aria-hidden");
});

// The social row is a second <nav>. Its links must not make the existing four ambiguous —
// getByRole throws on multiple matches, so the tests above already prove it, but this pins the
// two rows as distinguishable landmarks rather than one merged blob.
it("keeps the social row a separate landmark from the site information row", () => {
  render(<Footer />);
  const nav = screen.getByRole("navigation", { name: /social media/i });
  expect(nav).not.toContainElement(screen.getByRole("link", { name: "About" }));
  // Same reason as the site-information row: a fifth link one day must wrap, not overflow.
  expect(nav.className).toContain("flex-wrap");
});
