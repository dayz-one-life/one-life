import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MapPageView } from "./map-page";

vi.mock("./friends-map", () => ({ default: () => <div data-testid="friends-map" /> }));

const NOW = new Date("2026-07-22T12:00:00Z");
const data = { mapCodename: "sakhal", positions: [] };

describe("MapPageView", () => {
  it("prompts a signed-out visitor to sign in, never a blank canvas", () => {
    render(<MapPageView signedOut now={NOW} />);
    expect(screen.getByRole("status")).toHaveTextContent(/sign in/i);
    expect(screen.queryByTestId("friends-map")).toBeNull();
  });

  it("explains to a signed-in but unverified visitor", () => {
    render(<MapPageView unverified now={NOW} />);
    expect(screen.getByRole("status")).toHaveTextContent(/verify/i);
    expect(screen.queryByTestId("friends-map")).toBeNull();
  });

  it("shows a skeleton while loading, not an empty map", () => {
    const { container } = render(<MapPageView loading now={NOW} />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByTestId("friends-map")).toBeNull();
  });

  it("distinguishes a failed load from an empty map", () => {
    render(<MapPageView error now={NOW} />);
    expect(screen.getByRole("status")).toHaveTextContent(/couldn't load/i);
    expect(screen.queryByTestId("friends-map")).toBeNull();
  });

  it("renders each state as an overlay card, so the bar above it stays reachable", () => {
    // The bar lives in MapPage, not MapPageView; what this pins is that a state does not
    // replace the region's flow — it covers it, leaving the shell (and its only exit) intact.
    const { container } = render(<MapPageView signedOut now={NOW} />);
    expect(container.firstElementChild!.className).toMatch(/\babsolute\b.*\binset-0\b/);
  });

  it("writes its notes in dark-surface tokens — the shell has no paper anywhere", () => {
    // RTL asserts the DOM, not contrast: an ink-on-dark note is present, functional and
    // invisible, and every other test here still passes while it is.
    render(<MapPageView unverified now={NOW} />);
    const note = screen.getByRole("status");
    expect(note.className).not.toMatch(/\btext-ink/);
    expect(note.className).toMatch(/\btext-cream-dim\b/);
  });

  it("renders the map once loaded", () => {
    render(<MapPageView data={data} now={NOW} />);
    expect(screen.getByTestId("friends-map")).toBeInTheDocument();
  });
});
