import { describe, it, expect } from "vitest";
import { pngDimensions } from "../src/image-png.js";

// Minimal valid PNG header + IHDR for a 2x3 image.
function fakePng(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0); // signature
  b.writeUInt32BE(13, 8);                       // IHDR length
  b.write("IHDR", 12);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

describe("pngDimensions", () => {
  it("reads width/height from the IHDR", () => {
    expect(pngDimensions(fakePng(1024, 1536))).toEqual({ width: 1024, height: 1536 });
  });
  it("returns null for non-png bytes", () => {
    expect(pngDimensions(Buffer.from("not a png at all, sorry"))).toBeNull();
  });
});
