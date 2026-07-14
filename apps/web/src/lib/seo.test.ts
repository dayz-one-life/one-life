import { describe, it, expect } from "vitest";
import { absoluteUrl } from "./seo";

describe("seo helpers", () => {
  it("builds absolute urls", () => {
    expect(absoluteUrl("/chernarus/news/x")).toMatch(/^https?:\/\/.+\/chernarus\/news\/x$/);
  });
});
