import { describe, it, expect } from "vitest";
import { absoluteUrl, ldScript, birthNoticeLd, articleLd, newsLd } from "./seo";

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

describe("birthNoticeLd", () => {
  const article = { headline: "New Fool Ashore", lede: "L", gamertag: "Boots", bornAt: "2026-07-17T10:00:00Z" };
  it("emits a NewsArticle with bornAt as datePublished and the Fresh Spawns collection", () => {
    const ld = birthNoticeLd(article, "https://x/fresh-spawns/new-fool-ashore-3") as Record<string, unknown>;
    expect(ld["@type"]).toBe("NewsArticle");
    expect(ld.datePublished).toBe("2026-07-17T10:00:00Z");
    expect((ld.isPartOf as Record<string, unknown>).name).toBe("Fresh Spawns");
    expect((ld.about as Record<string, unknown>).name).toBe("Boots");
  });
  it("escapes </script> when rendered through ldScript", () => {
    const out = ldScript(birthNoticeLd({ ...article, headline: "X </script><script>alert(1)</script>" }, "https://x/y"));
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<");
    expect(out).toContain("\\u003c");
  });
  it("has no image key when no image is passed", () => {
    const ld = birthNoticeLd(article, "https://x/y") as Record<string, unknown>;
    expect(ld).not.toHaveProperty("image");
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

describe("newsLd", () => {
  const a = {
    headline: "Still Standing, Somewhere", lede: "L", createdAt: "2026-07-12T00:00:00Z",
    subjects: [{ gamertag: "GabeFox101" }, { gamertag: "CUPID18" }],
    imageUrl: "/media/heroes/x.png", retracted: false,
  };

  it("emits a NewsArticle about EVERY subject, dated created_at, in the News collection", () => {
    const ld = newsLd(a, "https://x/news/still-standing") as Record<string, unknown>;
    expect(ld["@type"]).toBe("NewsArticle");
    expect(ld.datePublished).toBe("2026-07-12T00:00:00Z");
    expect((ld.about as { name: string }[]).map((p) => p.name)).toEqual(["GabeFox101", "CUPID18"]);
    expect((ld.isPartOf as Record<string, unknown>).name).toBe("News");
    expect(ld).not.toHaveProperty("creativeWorkStatus");
  });

  // Retraction must reach the STRUCTURED DATA, not stop at the interior's visible banner. An
  // unqualified NewsArticle asserts a headline the desk has withdrawn.
  it("QUALIFIES a retracted feature and drops the image it can no longer serve", () => {
    const ld = newsLd({ ...a, retracted: true }, "https://x/news/still-standing") as Record<string, unknown>;
    expect(ld.creativeWorkStatus).toBe("Retracted");
    expect(ld).not.toHaveProperty("image");
  });

  it("escapes </script> when rendered through ldScript", () => {
    const out = ldScript(newsLd({ ...a, headline: "X </script><script>alert(1)</script>" }, "https://x/y"));
    expect(out).not.toContain("</script>");
    expect(out).toContain("\\u003c");
  });
});
