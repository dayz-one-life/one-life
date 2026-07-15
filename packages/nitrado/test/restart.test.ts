import { describe, it, expect } from "vitest";
import { NitradoClient } from "../src/client.js";

/** Fake fetch: records POST url + parsed body; returns a Nitrado success envelope. */
function makeFake(status = "success") {
  const posts: Array<{ url: string; body: unknown }> = [];
  const fetchFn = (async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "POST") {
      posts.push({ url, body: init.body ? JSON.parse(init.body) : undefined });
      return { ok: true, json: async () => ({ status, data: {} }) } as Response;
    }
    return { ok: true, json: async () => ({ status: "success", data: {} }) } as Response;
  }) as unknown as typeof fetch;
  return { fetchFn, posts };
}

describe("NitradoClient.restartServer", () => {
  it("POSTs the restart endpoint for its service id with an empty body", async () => {
    const { fetchFn, posts } = makeFake();
    const c = new NitradoClient("tok", 777, fetchFn);
    await c.restartServer();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe("https://api.nitrado.net/services/777/gameservers/restart");
    expect(posts[0]!.body).toEqual({});
  });

  it("throws when Nitrado returns a non-success envelope", async () => {
    const { fetchFn } = makeFake("error");
    const c = new NitradoClient("tok", 777, fetchFn);
    await expect(c.restartServer()).rejects.toThrow(/Nitrado/);
  });
});
