import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MapPageView, MapPage } from "./map-page";

vi.mock("./positions-map", () => ({ default: () => <div data-testid="positions-map" /> }));
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => ({ kind: "signedOut" }) }));
vi.mock("@/lib/api", () => ({
  getServers: async () => [{ id: 1, name: "Sakhal", map: "sakhal", slug: "sakhal" }],
  getMapShare: async () => ({ positions: [], online: [] }),
}));
vi.mock("@/lib/map-resolution", () => ({ rememberMap: () => {} }));

function wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const NOW = new Date("2026-07-22T12:00:00Z");
const MAP = "sakhal";

describe("MapPageView", () => {
  // ⚠️ THE CENTRAL RULE, and the inverse of what this file asserted until the Maps nav item
  // shipped: a visitor who cannot have DOTS still gets the MAP. The old behaviour returned the
  // sign-in card instead of the canvas, so `/maps` was a sentence on a dark background for
  // every signed-out visitor — which the primary-nav link then pointed the whole internet at.
  it("shows a signed-out visitor the terrain, with sign-in offered alongside it", () => {
    render(<MapPageView signedOut mapCodename={MAP} now={NOW} />);
    expect(screen.getByTestId("positions-map")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/sign in/i);
  });

  it("shows a signed-in but unverified visitor the terrain too", () => {
    render(<MapPageView unverified mapCodename={MAP} now={NOW} />);
    expect(screen.getByTestId("positions-map")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/verify/i);
  });

  // "Couldn't load" and "nobody is sharing" are different claims about the game. The terrain
  // is unaffected either way, so the failure belongs beside the map, not instead of it.
  it("keeps the map when the share payload fails, and says so", () => {
    render(<MapPageView shareError mapCodename={MAP} now={NOW} />);
    expect(screen.getByTestId("positions-map")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/couldn't load who's on the map/i);
  });

  it("says nothing at all when there is nothing to explain", () => {
    render(<MapPageView mapCodename={MAP} positions={[]} now={NOW} />);
    expect(screen.getByTestId("positions-map")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows a skeleton while the map itself is still resolving", () => {
    const { container } = render(<MapPageView loading now={NOW} />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByTestId("positions-map")).toBeNull();
  });

  // Without a codename there is no tile tree and no place list to draw, so there is no map to
  // render — a canvas would be a grey field claiming to be a place.
  it("does not pretend to draw a map with no codename", () => {
    const { container } = render(<MapPageView now={NOW} />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByTestId("positions-map")).toBeNull();
  });

  it("distinguishes a failed map load from an empty one", () => {
    render(<MapPageView error now={NOW} />);
    expect(screen.getByRole("status")).toHaveTextContent(/couldn't load the map/i);
    expect(screen.queryByTestId("positions-map")).toBeNull();
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

describe("MapPage inside the site shell", () => {
  // ⚠️ MapPage used to render its own `#main-content`, because it sat OUTSIDE the (site) route
  // group and the root layout's skip link had no other target. Inside the group the layout
  // supplies that id, and a second element carrying it would make the skip link resolve to
  // whichever comes first in the document — silently sending keyboard users to the wrong place.
  //
  // `(site)/layout.test.tsx` asserts there is exactly one, but it renders the layout ALONE, so
  // it cannot see a duplicate contributed by a page. This is that assertion.
  it("renders no #main-content of its own", () => {
    const { container } = render(<MapPage slug="sakhal" />, { wrapper: wrap });
    expect(container.querySelector("#main-content")).toBeNull();
  });

  // Leaflet measures its container on creation, so a parent chain with no resolved height
  // collapses the canvas to zero. The map fills the space the masthead and footer leave, which
  // only works if the page is a flex column with a definite height and the map box grows into
  // it. jsdom computes no layout, so this pins the classes that produce that chain.
  it("is a flex column with a height, and the map box grows to fill it", () => {
    const { container } = render(<MapPage slug="sakhal" />, { wrapper: wrap });
    const page = container.querySelector('[class*="min-h-[420px]"]')!;
    expect(page.className).toMatch(/\bflex\b/);
    expect(page.className).toMatch(/\bflex-col\b/);
    expect(page.className).toMatch(/\bflex-1\b/);
    const box = container.querySelector('[class*="isolate"]')!;
    expect(box.className).toMatch(/\bflex-1\b/);
    // Without `min-h-0` a flex item will not shrink below its content, so the map would push
    // the page taller than the viewport instead of fitting inside it.
    expect(box.className).toMatch(/\bmin-h-0\b/);
    // `.map-app` scopes the globals.css Leaflet-attribution clearance/dark styling to this
    // region only — the life-trail TrackMap panel has no overlaid controls and must keep
    // Leaflet's default placement, so the class must not be dropped in a refactor.
    expect(container.querySelector(".map-app")).not.toBeNull();
  });

  // The route sits OUTSIDE the (boxed) group, so the terrain reaches the viewport edge with no
  // negative-margin escape — a restored -mx would double-bleed past the viewport.
  it("carries no negative-margin bleed — full width comes from sitting outside (boxed)", () => {
    const { container } = render(<MapPage slug="sakhal" />, { wrapper: wrap });
    expect(container.querySelector('[class*="isolate"]')!.className).not.toMatch(/-mx/);
  });

  // The mock's rule: "the dropdown is the only header addition" — the switcher lives in the
  // masthead, and the page spends no vertical space on a visible title strip.
  it("keeps the h1 for AT but renders no visible header strip", () => {
    const { container } = render(<MapPage slug="sakhal" />, { wrapper: wrap });
    expect(container.querySelector("h1")!.className).toContain("sr-only");
    expect(container.querySelector("header")).toBeNull();
  });

  // Leaflet's own controls sit at z-index 1000 and would otherwise paint over the z-40 masthead
  // and the z-50 overlays. With a masthead above the map this is the thing between the two.
  it("keeps the isolate stacking context on the map box", () => {
    const { container } = render(<MapPage slug="sakhal" />, { wrapper: wrap });
    expect(container.querySelector('[class*="isolate"]')).not.toBeNull();
  });
});
