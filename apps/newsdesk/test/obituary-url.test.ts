import { describe, it, expect } from "vitest";
import { obituaryUrl } from "../src/obituary-url.js";

describe("obituaryUrl", () => {
  it("composes the interior obituary URL", () => {
    expect(obituaryUrl("https://dayzonelife.com", "the-king-is-dead-7-4")).toBe(
      "https://dayzonelife.com/obituaries/the-king-is-dead-7-4",
    );
  });

  it("strips exactly one trailing slash from siteUrl (mirrors seo.ts SITE_URL)", () => {
    expect(obituaryUrl("https://dayzonelife.com/", "abc")).toBe("https://dayzonelife.com/obituaries/abc");
  });
});
