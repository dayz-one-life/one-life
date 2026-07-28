import { render, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { CountUp } from "./count-up";

function stubMatchMedia(reduced: boolean) {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: reduced }));
}
afterEach(() => vi.unstubAllGlobals());

describe("CountUp", () => {
  it("under reduced motion, renders the real final value and never animates", () => {
    stubMatchMedia(true);
    const { container } = render(<CountUp value={1247} />);
    expect(container.textContent).toBe("1,247");
  });

  it("is aria-hidden — screen readers get the number from the hero's sr-only sentence instead", () => {
    stubMatchMedia(true);
    const { container } = render(<CountUp value={5} />);
    expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
  });

  // ADAPTED from the brief: vitest's fake timers don't reliably advance `performance.now()`
  // in this environment (jsdom rAF driven via a stubbed setTimeout), which made the
  // fake-timers version of this test flake at an intermediate eased value instead of landing
  // on the final figure. Real timers + a short duration + waitFor exercise the same three
  // behaviors — motion allowed, animation runs, it lands exactly on the final formatted value.
  it("with motion allowed, lands exactly on the final value when the animation completes", async () => {
    stubMatchMedia(false);
    const { container } = render(<CountUp value={1247} durationMs={20} />);
    await waitFor(() => expect(container.textContent).toBe("1,247"));
  });
});
