import { describe, expect, it } from "vitest";
import { clampView, initialView, minScale, sourceRect, MAX_ZOOM } from "./crop-geometry";

const FRAME = 200;
const WIDE = { width: 800, height: 400 }; // landscape
const TALL = { width: 400, height: 800 }; // portrait

describe("minScale", () => {
  // The SHORTER edge must exactly fill the frame; anything less leaves a gap in the circle.
  it("fills the frame from the shorter edge", () => {
    expect(minScale(WIDE, FRAME)).toBe(0.5); // 200/400 (height is shorter)
    expect(minScale(TALL, FRAME)).toBe(0.5); // 200/400 (width is shorter)
  });

  it("scales up an image smaller than the frame", () => {
    expect(minScale({ width: 100, height: 50 }, FRAME)).toBe(4); // 200/50
  });
});

describe("initialView", () => {
  it("starts at minimum zoom, centred", () => {
    const v = initialView(WIDE, FRAME);
    expect(v.scale).toBe(0.5);
    // Displayed 400x200; centred horizontally means offsetX = (200 - 400) / 2.
    expect(v.offsetX).toBe(-100);
    expect(v.offsetY).toBe(0);
  });
});

describe("clampView", () => {
  it("never lets the image zoom below full coverage", () => {
    const v = clampView({ scale: 0.1, offsetX: 0, offsetY: 0 }, WIDE, FRAME);
    expect(v.scale).toBe(0.5);
  });

  it("caps zoom at MAX_ZOOM times the minimum", () => {
    const v = clampView({ scale: 99, offsetX: 0, offsetY: 0 }, WIDE, FRAME);
    expect(v.scale).toBe(0.5 * MAX_ZOOM);
  });

  // The core invariant: no pan can ever expose a gutter inside the frame.
  it("clamps panning so the frame stays fully covered", () => {
    // Displayed 400x200. offsetX must stay within [200 - 400, 0] = [-200, 0].
    expect(clampView({ scale: 0.5, offsetX: 50, offsetY: 0 }, WIDE, FRAME).offsetX).toBe(0);
    expect(clampView({ scale: 0.5, offsetX: -999, offsetY: 0 }, WIDE, FRAME).offsetX).toBe(-200);
    // The short axis has exactly zero slack at minimum scale.
    expect(clampView({ scale: 0.5, offsetX: 0, offsetY: -80 }, WIDE, FRAME).offsetY).toBe(0);
  });

  it("re-clamps the offset when a zoom-out would strand the image off-frame", () => {
    // Zoomed in and panned hard right, then zoomed back out: the old offset is now illegal.
    const zoomed = clampView({ scale: 1.5, offsetX: -900, offsetY: -500 }, WIDE, FRAME);
    const out = clampView({ ...zoomed, scale: 0.5 }, WIDE, FRAME);
    expect(out.offsetX).toBe(-200);
    expect(out.offsetY).toBe(0);
  });
});

describe("sourceRect", () => {
  it("maps a centred minimum-zoom view to the centred square of the source", () => {
    const r = sourceRect(initialView(WIDE, FRAME), WIDE, FRAME);
    expect(r).toEqual({ sx: 200, sy: 0, size: 400 }); // the middle 400x400 of an 800x400
  });

  it("maps a panned view to the corresponding source pixels", () => {
    const r = sourceRect({ scale: 0.5, offsetX: 0, offsetY: 0 }, WIDE, FRAME);
    expect(r).toEqual({ sx: 0, sy: 0, size: 400 }); // hard left
  });

  it("shrinks the source square as zoom increases", () => {
    const r = sourceRect({ scale: 1, offsetX: -200, offsetY: -200 }, WIDE, FRAME);
    expect(r).toEqual({ sx: 200, sy: 200, size: 200 });
  });
});
