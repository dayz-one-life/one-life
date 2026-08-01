import { vi } from "vitest";
vi.stubGlobal("ResizeObserver", vi.fn().mockImplementation(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })));

import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { FitLine, fitFontSize } from "./fit-line";

describe("fitFontSize", () => {
  it("scales the base size by container/clone ratio", () => {
    expect(fitFontSize(500, 1000, 50, 24, 200)).toBe(100);
  });
  it("clamps to max", () => {
    expect(fitFontSize(100, 10000, 50, 24, 160)).toBe(160);
  });
  it("clamps to min", () => {
    expect(fitFontSize(5000, 300, 50, 24, 160)).toBe(24);
  });
  it("returns the base size when the clone width is unmeasurable (jsdom, 0)", () => {
    expect(fitFontSize(0, 1000, 50, 24, 160)).toBe(50);
  });
});

describe("FitLine", () => {
  it("renders children and a hidden measuring clone carrying the final text", () => {
    const { container } = render(
      <FitLine finalText="DEATHS TO DATE: 4,213">
        <span>DEATHS TO DATE: 0</span>
      </FitLine>,
    );
    expect(container.textContent).toContain("DEATHS TO DATE: 0");
    // The clone is measurement-only: aria-hidden and invisible.
    const clone = container.querySelector("[data-fitline-clone]");
    expect(clone).not.toBeNull();
    expect(clone).toHaveAttribute("aria-hidden", "true");
    expect(clone!.textContent).toBe("DEATHS TO DATE: 4,213");
  });

  /**
   * ⚠️ Regression: the whole site scrolled sideways on a phone. The clone is `absolute` and
   * `whitespace-nowrap` at a fixed 50px, so its box is far wider than a phone — 452px of it on a
   * 320px screen — and `visibility: hidden` does NOT take an element out of the document's
   * SCROLLABLE OVERFLOW. Measured on production before the fix: `documentElement.scrollWidth`
   * 453 at a 390px viewport, 452 at 320px; deleting the clones alone took it to exactly the
   * viewport width. The clone therefore has to sit inside something that clips.
   *
   * jsdom computes no layout, so this can only pin the STRUCTURE that does the clipping — that
   * the clone's parent is zero-sized and `overflow-hidden`. That the clipping neither changes the
   * measurement nor leaves any overflow behind was verified in a real browser over CDP
   * (measured widths identical at 428/372px, `scrollWidth` down to the viewport).
   */
  it("keeps the measuring clone inside a zero-size clipping wrapper", () => {
    const { container } = render(
      <FitLine finalText="DEATHS TO DATE: 4,213">
        <span>DEATHS TO DATE: 0</span>
      </FitLine>,
    );
    const clone = container.querySelector("[data-fitline-clone]")!;
    const wrapper = clone.parentElement!;
    expect(wrapper).not.toBe(container.firstElementChild); // it is not the container itself
    expect(wrapper.className).toContain("overflow-hidden");
    expect(wrapper.className).toContain("h-0");
    expect(wrapper.className).toContain("w-0");
    // Out of flow, so clipping costs the visible line no space.
    expect(wrapper.className).toContain("absolute");
  });

  it("applies lineClassName to the visible line only — never the measuring clone", () => {
    const { container } = render(
      <FitLine finalText="DEATHS TO DATE: 4,213" lineClassName="text-[clamp(2.5rem,9vw,10rem)]">
        <span>DEATHS TO DATE: 0</span>
      </FitLine>,
    );
    const clone = container.querySelector("[data-fitline-clone]");
    expect(clone!.className).not.toContain("text-[clamp");
    // The clone now sits inside its clipping wrapper, so the visible line is the wrapper's
    // sibling rather than the clone's.
    const line = clone!.parentElement!.nextElementSibling as HTMLElement;
    expect(line.className).toContain("text-[clamp(2.5rem,9vw,10rem)]");
  });
});
