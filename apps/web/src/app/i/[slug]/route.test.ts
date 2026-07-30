import { describe, it, expect } from "vitest";
import { GET } from "./route";
import { REFERRAL_COOKIE } from "@/lib/referral-cookie";

const call = (slug: string) =>
  GET(new Request(`https://dayzonelife.com/i/${slug}`), { params: Promise.resolve({ slug }) });

describe("GET /i/[slug]", () => {
  it("returns 200 HTML with OG tags and a bounce to /", async () => {
    const res = await GET(new Request("https://dayzonelife.com/i/vixxen-84"), { params: Promise.resolve({ slug: "vixxen-84" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain('property="og:title" content="VIXXEN-84 dares you to survive DayZ One Life"');
    expect(html).toContain('property="og:image" content="https://dayzonelife.com/i/vixxen-84/card"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).toContain('location.replace("/")');
    expect(html).toContain("http-equiv=\"refresh\"");
  });

  it("escapes HTML in the slug", async () => {
    // Non-storable slug with special chars should not crash; storable slugs use esc() defensively
    const res = await GET(new Request("https://x.test/i/a%3Cb%3E"), { params: Promise.resolve({ slug: 'a<b>' }) });
    const html = await res.text();
    // Slug is non-storable, so no personalization; verify it doesn't appear in title
    expect(html).toContain("Someone dares you to survive DayZ One Life");
    expect(html).not.toContain("a<b>");
  });

  it("renders generic copy and sets no cookie for a non-storable slug", async () => {
    const res = await call("../../evil");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Someone dares you to survive DayZ One Life");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).not.toContain("evil");
  });

  it("sets an httpOnly, Lax, 30-day referral cookie naming the slug", async () => {
    const cookie = (await call("manicdote")).headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${REFERRAL_COOKIE}=manicdote`);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    expect(cookie).toContain("Max-Age=2592000");
  });

  it("does not reflect a slug it cannot store safely", async () => {
    const cookie = (await call("../../evil")).headers.get("set-cookie") ?? "";
    expect(cookie).not.toContain("evil");
  });
});
