import { describe, it, expect } from "vitest";
import { GET } from "./route";
import { REFERRAL_COOKIE } from "@/lib/referral-cookie";

const call = (slug: string) =>
  GET(new Request(`https://dayzonelife.com/i/${slug}`), { params: Promise.resolve({ slug }) });

describe("GET /i/[slug]", () => {
  it("307s to / — never 308, the destination depends on the session", async () => {
    const res = await call("manicdote");
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/");
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
