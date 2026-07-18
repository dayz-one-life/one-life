import { describe, it, expect } from "vitest";
import { IMAGE_STYLE, IMAGE_ANTISLOP, buildImagePrompt } from "../src/image-prompt.js";

describe("buildImagePrompt", () => {
  it("assembles scene + style + anti-slop + aspect, in order", () => {
    const p = buildImagePrompt("A dropped rifle in wet grass.", "hero");
    expect(p).toBe(`A dropped rifle in wet grass.\n\n${IMAGE_STYLE}\n\n${IMAGE_ANTISLOP}\n\nAspect ratio 4:5.`);
  });
  it("defaults to hero", () => {
    expect(buildImagePrompt("x")).toContain("Aspect ratio 4:5.");
  });
  it("maps card and breaking ratios", () => {
    expect(buildImagePrompt("x", "card")).toContain("Aspect ratio 1:1.");
    expect(buildImagePrompt("x", "breaking")).toContain("Aspect ratio 16:9.");
  });
  it("throws on an unknown kind", () => {
    expect(() => buildImagePrompt("x", "poster" as never)).toThrow(/unknown image kind/i);
  });
  it("style signature and anti-slop are the fixed §10.4 text", () => {
    expect(IMAGE_STYLE).toMatch(/^Shot on a cheap 1990s point-and-shoot film camera/);
    expect(IMAGE_STYLE).toMatch(/Photorealistic, imperfect, real\.$/);
    expect(IMAGE_ANTISLOP).toMatch(/^It must NOT look like:/);
    expect(IMAGE_ANTISLOP).toMatch(/professionally composed\.$/);
  });
});
