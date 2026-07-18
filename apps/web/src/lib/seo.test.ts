import { describe, it, expect } from "vitest";
import { absoluteUrl, ldScript, birthNoticeLd } from "./seo";

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
});
