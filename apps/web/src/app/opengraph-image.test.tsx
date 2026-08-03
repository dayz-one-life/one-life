import { describe, it, expect } from "vitest";
import OgImage, { size, contentType, alt } from "./opengraph-image";

describe("root opengraph-image", () => {
  it("declares the OG image contract", () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    expect(typeof alt).toBe("string");
  });

  it("renders the static brand PNG", async () => {
    const res = await OgImage();
    expect(res.headers.get("content-type")).toContain("image/png");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });
});
