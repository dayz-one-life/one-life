import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MapBottomBar } from "./bottom-bar";

describe("MapBottomBar", () => {
  it("carries the controls a thumb reaches for", () => {
    render(
      <MapBottomBar chip={<button type="button">064 023</button>}>
        <button type="button">Locate</button>
      </MapBottomBar>,
    );
    expect(screen.getByRole("button", { name: "064 023" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Locate" })).toBeInTheDocument();
  });

  it("only exists below md — above it, the controls stay in the top bar", () => {
    // Not decoration: without this the same controls render twice, and two live copies of a
    // control is worse than one in the wrong place.
    const { container } = render(<MapBottomBar chip={null}>{null}</MapBottomBar>);
    expect(container.firstElementChild!.className).toMatch(/\bmd:hidden\b/);
  });

  it("sits in the flow, not over the map", () => {
    // An overlay would float controls over terrain and need a z-altitude; the LAYER LEGEND
    // (components/header.tsx) has exactly three and this must not become a fourth.
    const { container } = render(<MapBottomBar chip={null}>{null}</MapBottomBar>);
    const cls = container.firstElementChild!.className;
    expect(cls).toMatch(/\bshrink-0\b/);
    expect(cls).not.toMatch(/\b(?:fixed|absolute)\b/);
    expect(cls).not.toMatch(/\bz-\d+\b/);
  });

  it("is written in dark-surface tokens, like the bar it mirrors", () => {
    const { container } = render(<MapBottomBar chip={null}>{null}</MapBottomBar>);
    const cls = container.firstElementChild!.className;
    expect(cls).toMatch(/\bbg-dark\b/);
    expect(cls).not.toMatch(/\bbg-(?:paper|bone)\b/);
  });

  it("keeps clear of the home indicator on a gesture phone", () => {
    const { container } = render(<MapBottomBar chip={null}>{null}</MapBottomBar>);
    expect(container.firstElementChild!.className).toContain("safe-area-inset-bottom");
  });
});
