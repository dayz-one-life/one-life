import { describe, it, expect } from "vitest";
import { GET } from "./route";
import { REFERRAL_COOKIE } from "@/lib/referral-cookie";

const call = (slug: string) =>
  GET(new Request(`https://dayzonelife.com/i/${slug}`), { params: Promise.resolve({ slug }) });

describe("GET /i/[slug]", () => {
  it("returns 200 HTML with OG tags and a bounce to /", async () => {
    // isStorableSlug only allows [a-z0-9-]{1,64}, so the fixture must stay within that charset
    // for personalization to kick in — a hyphen, not the brief's literal underscore example.
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
    // A slug carrying HTML-significant characters is never storable (isStorableSlug only
    // accepts [a-z0-9-]), so it never reaches the personalized `name`/esc() path — it must
    // fall back to the generic, unpersonalized copy, and the raw payload must never be
    // reflected anywhere in the document (title, meta content, or the og:url/og:image href,
    // where it would otherwise ride through unescaped and break out of an attribute).
    const payload = '"><script>alert(1)</script>';
    const res = await GET(new Request(`https://x.test/i/${encodeURIComponent(payload)}`), {
      params: Promise.resolve({ slug: payload }),
    });
    const html = await res.text();
    expect(html).not.toContain(payload);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain('"><script');
    expect(html).toContain("Someone dares you to survive DayZ One Life");
  });

  it("renders generic copy and sets no cookie for a non-storable slug", async () => {
    // Reuses the file's existing non-storable fixture value ("../../evil") from the cookie
    // tests below.
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
