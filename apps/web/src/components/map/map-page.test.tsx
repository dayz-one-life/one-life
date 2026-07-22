import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MapPageView } from "./map-page";

vi.mock("./friends-map", () => ({ default: () => <div data-testid="friends-map" /> }));

const NOW = new Date("2026-07-22T12:00:00Z");
const MAP = "sakhal";

describe("MapPageView", () => {
  // ⚠️ THE CENTRAL RULE, and the inverse of what this file asserted until the Maps nav item
  // shipped: a visitor who cannot have DOTS still gets the MAP. The old behaviour returned the
  // sign-in card instead of the canvas, so `/maps` was a sentence on a dark background for
  // every signed-out visitor — which the primary-nav link then pointed the whole internet at.
  it("shows a signed-out visitor the terrain, with sign-in offered alongside it", () => {
    render(<MapPageView signedOut mapCodename={MAP} now={NOW} />);
    expect(screen.getByTestId("friends-map")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/sign in/i);
  });

  it("shows a signed-in but unverified visitor the terrain too", () => {
    render(<MapPageView unverified mapCodename={MAP} now={NOW} />);
    expect(screen.getByTestId("friends-map")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/verify/i);
  });

  // "Couldn't load" and "nobody is sharing" are different claims about the game. The terrain
  // is unaffected either way, so the failure belongs beside the map, not instead of it.
  it("keeps the map when the friend payload fails, and says so", () => {
    render(<MapPageView friendsError mapCodename={MAP} now={NOW} />);
    expect(screen.getByTestId("friends-map")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/couldn't load who's on the map/i);
  });

  it("says nothing at all when there is nothing to explain", () => {
    render(<MapPageView mapCodename={MAP} positions={[]} now={NOW} />);
    expect(screen.getByTestId("friends-map")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows a skeleton while the map itself is still resolving", () => {
    const { container } = render(<MapPageView loading now={NOW} />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByTestId("friends-map")).toBeNull();
  });

  // Without a codename there is no tile tree and no place list to draw, so there is no map to
  // render — a canvas would be a grey field claiming to be a place.
  it("does not pretend to draw a map with no codename", () => {
    const { container } = render(<MapPageView now={NOW} />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByTestId("friends-map")).toBeNull();
  });

  it("distinguishes a failed map load from an empty one", () => {
    render(<MapPageView error now={NOW} />);
    expect(screen.getByRole("status")).toHaveTextContent(/couldn't load the map/i);
    expect(screen.queryByTestId("friends-map")).toBeNull();
  });

  it("renders a blocking state as an overlay card, so the bar above it stays reachable", () => {
    // The bar lives in MapPage, not MapPageView; what this pins is that a state does not
    // replace the region's flow — it covers it, leaving the shell (and its only exit) intact.
    const { container } = render(<MapPageView error now={NOW} />);
    expect(container.firstElementChild!.className).toMatch(/\babsolute\b.*\binset-0\b/);
  });

  // The whole point of the strip: it sits over the map without taking it away, and without
  // swallowing the drags and clicks that belong to Leaflet underneath.
  it("floats the note over the map without covering or capturing it", () => {
    const { container } = render(<MapPageView signedOut mapCodename={MAP} now={NOW} />);
    const strip = container.querySelector('[class*="pointer-events-none"]')!;
    expect(strip.className).not.toMatch(/\binset-0\b/);
    expect(strip.className).toMatch(/\bpointer-events-none\b/);
    // ...but the sign-in link inside it must still be clickable.
    expect(screen.getByRole("link", { name: /sign in/i }).closest('[class*="pointer-events-auto"]'))
      .not.toBeNull();
  });

  it("writes its notes in dark-surface tokens — the shell has no paper anywhere", () => {
    // RTL asserts the DOM, not contrast: an ink-on-dark note is present, functional and
    // invisible, and every other test here still passes while it is.
    render(<MapPageView unverified mapCodename={MAP} now={NOW} />);
    const note = screen.getByRole("status");
    expect(note.className).not.toMatch(/\btext-ink/);
    expect(note.className).toMatch(/\btext-cream-dim\b/);
  });

  it("offers sign-in in plain red — `red-deep` is a light-surface token", () => {
    render(<MapPageView signedOut mapCodename={MAP} now={NOW} />);
    const link = screen.getByRole("link", { name: /sign in/i });
    expect(link.className).toMatch(/\btext-red\b/);
    expect(link.className).not.toMatch(/\btext-red-deep\b/);
  });
});
