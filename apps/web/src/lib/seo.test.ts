import { describe, it, expect } from "vitest";
import { absoluteUrl, ldScript } from "./seo";

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
