import { describe, it, expect, vi, beforeEach } from "vitest";
import { REFERRAL_COOKIE } from "@/lib/referral-cookie";

const upstreamSpy = vi.fn();
vi.mock("@/lib/api", () => ({
  postReferrerClaim: (slug: string) => upstreamSpy(slug),
}));

let jar: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === REFERRAL_COOKIE && jar ? { value: jar } : undefined) }),
}));

const { POST } = await import("./route");

beforeEach(() => {
  upstreamSpy.mockReset().mockResolvedValue({ ok: true, claimed: true });
  jar = undefined;
});

describe("POST /api/referral/claim", () => {
  it("forwards the slug upstream and clears the cookie on success", async () => {
    jar = "manicdote";
    const res = await POST();
    expect(upstreamSpy).toHaveBeenCalledWith("manicdote");
    expect(res.headers.get("set-cookie") ?? "").toContain("Max-Age=0");
  });

  it("clears the cookie even when the upstream claim fails", async () => {
    jar = "manicdote";
    upstreamSpy.mockRejectedValue(new Error("upstream down"));
    const res = await POST();
    expect(res.status).toBe(200);
    // ⚠️ A cookie that survives a failed claim retries forever, on every page load, for 30 days.
    expect(res.headers.get("set-cookie") ?? "").toContain("Max-Age=0");
  });

  it("does nothing and clears nothing when there is no cookie", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(upstreamSpy).not.toHaveBeenCalled();
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
