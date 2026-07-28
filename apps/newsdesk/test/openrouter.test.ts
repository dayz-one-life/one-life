import { describe, it, expect, afterEach, vi } from "vitest";
import { openrouterComplete } from "../src/openrouter.js";

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; vi.restoreAllMocks(); });

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as any;
}

describe("openrouterComplete", () => {
  it("returns choices[0].message.content on 200 and sends auth + json mode", async () => {
    const f = mockFetch(200, { choices: [{ message: { content: "{\"ok\":true}" } }] });
    global.fetch = f as unknown as typeof fetch;
    const out = await openrouterComplete({ apiKey: "k", model: "m", user: "hi" });
    expect(out).toBe('{"ok":true}');
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const i = init as RequestInit;
    expect((i.headers as Record<string, string>).Authorization).toBe("Bearer k");
    const sent = JSON.parse(i.body as string);
    expect(sent.model).toBe("m");
    expect(sent.response_format).toEqual({ type: "json_object" });
  });

  it("throws on a non-2xx with the error message", async () => {
    global.fetch = mockFetch(429, { error: { message: "rate limited" } }) as unknown as typeof fetch;
    await expect(openrouterComplete({ apiKey: "k", model: "m", user: "hi" })).rejects.toThrow(/rate limited/);
  });

  it("throws on empty completion content", async () => {
    global.fetch = mockFetch(200, { choices: [{ message: { content: "  " } }] }) as unknown as typeof fetch;
    await expect(openrouterComplete({ apiKey: "k", model: "m", user: "hi" })).rejects.toThrow(/empty/i);
  });
});
