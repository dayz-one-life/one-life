import { describe, it, expect } from "vitest";
import {
  absoluteUrl,
  ldScript,
  articleLd,
  organizationLd,
  OG_DEFAULTS,
  SITE_CARD_IMAGES,
  SITE_DESCRIPTION,
} from "./seo";

describe("seo helpers", () => {
  it("builds absolute urls", () => {
    expect(absoluteUrl("/chernarus/news/x")).toMatch(/^https?:\/\/.+\/chernarus\/news\/x$/);
  });
});

describe("ldScript", () => {
  it("escapes </script> so LLM headlines cannot break out of the JSON-LD tag", () => {
    const out = ldScript({ headline: "Dead </script><script>alert(1)</script>" });
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).toContain("\\u003c");
    expect(out).toContain("\\u003e");
  });
  it("escapes ampersands and stays valid, round-trippable JSON", () => {
    const obj = { a: "Tom & Jerry <b> \"q\"", n: 3 };
    const out = ldScript(obj);
    expect(out).not.toContain("&");
    expect(out).toContain("\\u0026");
    expect(JSON.parse(out)).toEqual(obj);
  });
});

describe("articleLd", () => {
  const article = { headline: "Shot Dead at Tisy", lede: "L", gamertag: "Chicken", deathAt: "2026-07-17T10:00:00Z" };
  it("emits a NewsArticle with deathAt as datePublished and the Obituaries collection", () => {
    const ld = articleLd(article, "https://x/obituaries/shot-dead-at-tisy-3") as Record<string, unknown>;
    expect(ld["@type"]).toBe("NewsArticle");
    expect(ld.datePublished).toBe("2026-07-17T10:00:00Z");
    expect((ld.isPartOf as Record<string, unknown>).name).toBe("Obituaries");
    expect((ld.about as Record<string, unknown>).name).toBe("Chicken");
  });
  it("escapes </script> when rendered through ldScript", () => {
    const out = ldScript(articleLd({ ...article, headline: "X </script><script>alert(1)</script>" }, "https://x/y"));
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<");
    expect(out).toContain("\\u003c");
  });
  it("has no image key when no image is passed", () => {
    const ld = articleLd(article, "https://x/y") as Record<string, unknown>;
    expect(ld).not.toHaveProperty("image");
  });
});

describe("OG defaults", () => {
  it("carries siteName and locale for page-level openGraph spreads", () => {
    expect(OG_DEFAULTS).toEqual({ siteName: "One Life", locale: "en_US" });
  });
  // ⚠️ Deliberately NOT part of OG_DEFAULTS: every page spreads those defaults, including the
  // ones that render their own colocated card, and an `images` key there would override the
  // file-convention image with the generic site card.
  it("keeps the site card out of the blanket defaults", () => {
    expect(OG_DEFAULTS).not.toHaveProperty("images");
  });
  it("single-sources the site description", () => {
    expect(SITE_DESCRIPTION).toContain("permadeath");
  });
});

describe("site card", () => {
  it("points at the root card route with the dimensions unfurlers read", () => {
    expect(SITE_CARD_IMAGES).toEqual([
      { url: absoluteUrl("/opengraph-image"), width: 1200, height: 630, alt: "One Life — hardcore permadeath DayZ" },
    ]);
  });
  // Absolute, not "/opengraph-image": relative image URLs resolve against `metadataBase`, which
  // is set from an env var. A card that 404s for the crawler is the same as no card.
  it("is an absolute url", () => {
    expect(SITE_CARD_IMAGES[0]?.url).toMatch(/^https?:\/\//);
  });
});

describe("organizationLd", () => {
  const sameAs = ["https://discord.gg/x", "https://x.com/y"];

  it("emits an Organization carrying the accounts as sameAs", () => {
    const ld = organizationLd(sameAs) as Record<string, unknown>;
    expect(ld["@type"]).toBe("Organization");
    expect(ld.name).toBe("One Life");
    expect(ld.sameAs).toEqual(sameAs);
  });

  // sameAs is the whole point of the node: it is what ties these off-site accounts back to this
  // domain. An Organization without it is an empty gesture, so an empty list must not silently
  // produce one.
  it("omits sameAs entirely rather than emitting an empty array", () => {
    expect(organizationLd([])).not.toHaveProperty("sameAs");
  });

  // Same reason as the share card: a relative logo resolves against metadataBase, which comes
  // from an env var, and a crawler that 404s on it just drops the logo.
  it("uses absolute urls for the site and the logo", () => {
    const ld = organizationLd(sameAs) as Record<string, unknown>;
    expect(ld.url).toMatch(/^https?:\/\//);
    expect(ld.logo).toMatch(/^https?:\/\//);
  });

  it("escapes </script> when rendered through ldScript", () => {
    const out = ldScript(organizationLd(["https://x/</script><script>alert(1)</script>"]));
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<");
  });
});
