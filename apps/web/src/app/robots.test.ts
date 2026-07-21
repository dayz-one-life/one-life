import { describe, it, expect } from "vitest";
import robots from "./robots";

describe("robots", () => {
  it("allows crawling by default", () => {
    const r = robots();
    expect(r.rules).toMatchObject({ userAgent: "*", allow: "/" });
  });

  it("disallows the routes that are private or not content", () => {
    const disallow = (robots().rules as { disallow: string[] }).disallow;
    expect(disallow).toEqual(expect.arrayContaining(["/login", "/welcome", "/notifications", "/api"]));
  });

  it("points at the sitemap on this deployment's own host", () => {
    expect(robots().sitemap).toBe("https://dayzonelife.com/sitemap.xml");
  });
});
