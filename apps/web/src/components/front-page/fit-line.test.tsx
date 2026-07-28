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
});
