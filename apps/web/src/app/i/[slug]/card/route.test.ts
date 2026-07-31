import { describe, it, expect } from "vitest";
import { GET } from "./route";

describe("GET /i/[slug]/card", () => {
  it("returns a 1200x630 png", async () => {
    const res = await GET(new Request("https://x.test/i/vixxen-84/card"), {
      params: Promise.resolve({ slug: "vixxen-84" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
  });

  it("does not throw on a non-storable slug (generic card)", async () => {
    const res = await GET(new Request("https://x.test/i/%00/card"), {
      params: Promise.resolve({ slug: "\0" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
  });
});
