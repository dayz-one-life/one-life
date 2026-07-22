import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Box } from "./checkbox";

describe("Box", () => {
  // Both decorative layers are aria-hidden, so RTL's role queries cannot reach them and
  // jsdom computes no opacity — the tokens themselves are what this pins.
  //
  // The failure it guards: the fill carried `peer-disabled:opacity-50` and the checkmark did
  // not, so a disabled+checked control drew a full-opacity checkmark over a half-opacity fill.
  // The two must dim together or the glyph reads as more "on" than the control containing it.
  it("dims the checkmark and the fill together when disabled", () => {
    const { container } = render(<Box checked disabled onChange={() => {}} />);
    const fill = container.querySelector("span > span[aria-hidden]")!;
    const check = container.querySelector("svg[aria-hidden]")!;
    expect(fill.className).toContain("peer-disabled:opacity-50");
    expect(check.getAttribute("class")).toContain("peer-disabled:opacity-50");
  });
});
