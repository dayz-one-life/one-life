import { describe, it, expect, vi, afterEach } from "vitest";
import { openrouterImage } from "../src/openrouter.js";

const PNG_B64 = Buffer.from("fake-png-bytes").toString("base64");

afterEach(() => vi.unstubAllGlobals());

function stubFetch(response: unknown, status = 200) {
  const fn = vi.fn(async () => new Response(JSON.stringify(response), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("openrouterImage", () => {
  it("POSTs /api/v1/images with model, prompt, quality, n:1 and decodes b64_json", async () => {
    const fn = stubFetch({ data: [{ b64_json: PNG_B64, media_type: "image/png" }], usage: { cost: 0.003 } });
    const out = await openrouterImage({ apiKey: "k", model: "openai/gpt-5-image-mini", prompt: "p", quality: "low" });
    expect(out.bytes.equals(Buffer.from("fake-png-bytes"))).toBe(true);
    expect(out.contentType).toBe("image/png");
    const [url, init] = fn.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/images");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect(JSON.parse(init.body as string)).toEqual({ model: "openai/gpt-5-image-mini", prompt: "p", quality: "low", n: 1 });
  });
  it("defaults a missing media_type to image/png", async () => {
    stubFetch({ data: [{ b64_json: PNG_B64 }] });
    const out = await openrouterImage({ apiKey: "k", model: "m", prompt: "p", quality: "low" });
    expect(out.contentType).toBe("image/png");
  });
  it("throws with the API error message on non-2xx", async () => {
    stubFetch({ error: { message: "content policy" } }, 400);
    await expect(openrouterImage({ apiKey: "k", model: "m", prompt: "p", quality: "low" })).rejects.toThrow(/content policy/);
  });
  it("throws when data[0].b64_json is missing", async () => {
    stubFetch({ data: [] });
    await expect(openrouterImage({ apiKey: "k", model: "m", prompt: "p", quality: "low" })).rejects.toThrow(/no image/i);
  });
  it("throws when the decoded image exceeds the 10MB size cap", async () => {
    // ~10MB+1 byte of raw content, cheaply constructed, then base64-encoded — decodes back to
    // just over the cap.
    const oversizeB64 = Buffer.alloc(10_000_001).toString("base64");
    stubFetch({ data: [{ b64_json: oversizeB64, media_type: "image/png" }] });
    await expect(openrouterImage({ apiKey: "k", model: "m", prompt: "p", quality: "low" })).rejects.toThrow(/10MB/);
  });
});
