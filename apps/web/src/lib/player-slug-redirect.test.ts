import { describe, it, expect } from "vitest";
import { shouldRedirectSlug } from "./player-page-href";

describe("shouldRedirectSlug", () => {
  it("does not redirect when the slug already names the current gamertag", () => {
    expect(shouldRedirectSlug("tds-maverick12", "tds maverick12")).toBe(false);
  });

  it("redirects when the slug came from a former gamertag", () => {
    expect(shouldRedirectSlug("daddyishome", "tds maverick12")).toBe(true);
  });

  it("does not redirect on a mere casing difference in the URL", () => {
    expect(shouldRedirectSlug("TDS-Maverick12", "tds maverick12")).toBe(false);
  });
});
