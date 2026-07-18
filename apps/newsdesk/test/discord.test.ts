import { describe, it, expect } from "vitest";
import { postToDiscordWebhook } from "../src/discord.js";

function fakeFetch(response: Partial<Response> & { throws?: unknown }, calls: unknown[]) {
  return (async (url: unknown, init: unknown) => {
    calls.push({ url, init });
    if (response.throws) throw response.throws;
    return response as Response;
  }) as unknown as typeof fetch;
}

describe("postToDiscordWebhook", () => {
  it("POSTs JSON { content } and returns ok on 204", async () => {
    const calls: any[] = [];
    const res = await postToDiscordWebhook("https://hook", "https://site/obituaries/x", {
      fetch: fakeFetch({ ok: true, status: 204 }, calls),
    });
    expect(res).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://hook");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(calls[0].init.body)).toEqual({ content: "https://site/obituaries/x" });
  });

  it("maps 429 to rateLimited with retry_after seconds", async () => {
    const res = await postToDiscordWebhook("https://hook", "u", {
      fetch: fakeFetch({ ok: false, status: 429, json: async () => ({ retry_after: 1.5 }) } as any, []),
    });
    expect(res).toEqual({ ok: false, rateLimited: true, retryAfterSeconds: 1.5 });
  });

  it("maps other non-2xx to a non-rate-limited error", async () => {
    const res = await postToDiscordWebhook("https://hook", "u", {
      fetch: fakeFetch({ ok: false, status: 400, text: async () => "Bad Request" } as any, []),
    });
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.rateLimited).toBe(false);
      if (res.rateLimited === false) expect(res.error).toContain("400");
    }
  });

  it("maps a network throw to a non-rate-limited error", async () => {
    const res = await postToDiscordWebhook("https://hook", "u", {
      fetch: fakeFetch({ throws: new Error("ECONNREFUSED") }, []),
    });
    expect(res).toEqual({ ok: false, rateLimited: false, error: "ECONNREFUSED" });
  });
});
