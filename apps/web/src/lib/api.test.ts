import { describe, it, expect, vi, afterEach } from "vitest";
import { apiGet, apiSend, ApiError, getRoster, toBackendPath } from "./api";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockFetch(status: number, body: unknown) {
  return vi.fn(async (..._args: unknown[]) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

describe("apiGet (client path)", () => {
  it("calls the relative /api URL with credentials and returns JSON", async () => {
    const f = mockFetch(200, [{ gamertag: "A", sessionSeconds: 1, lifeSeconds: 2 }]);
    global.fetch = f as unknown as typeof fetch;
    const rows = await getRoster(7);
    expect(rows[0]!.gamertag).toBe("A");
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("/api/servers/7/roster");
    expect((init as RequestInit).credentials).toBe("include");
  });

  it("throws ApiError carrying status and code on non-2xx", async () => {
    global.fetch = mockFetch(404, { error: "not_found" }) as unknown as typeof fetch;
    await expect(apiGet("/api/servers/7/players/nobody")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      code: "not_found",
    });
  });

  it("rejects with an ApiError (not a SyntaxError) on a non-JSON error body", async () => {
    global.fetch = vi.fn(async (..._args: unknown[]) =>
      new Response("<html>bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } }),
    ) as unknown as typeof fetch;
    await expect(apiGet("/api/servers")).rejects.toMatchObject({
      name: "ApiError",
      status: 502,
    });
  });
});

describe("toBackendPath", () => {
  it("strips the /api prefix from read/me/gamertag routes", () => {
    expect(toBackendPath("/api/servers/7/roster")).toBe("/servers/7/roster");
    expect(toBackendPath("/api/me/gamertag-links")).toBe("/me/gamertag-links");
  });

  it("leaves the auth prefix untouched", () => {
    expect(toBackendPath("/api/auth/get-session")).toBe("/api/auth/get-session");
    expect(toBackendPath("/api/auth")).toBe("/api/auth");
  });
});

describe("apiSend", () => {
  it("POSTs a JSON body and returns parsed JSON", async () => {
    const f = mockFetch(201, { linkId: 1 });
    global.fetch = f as unknown as typeof fetch;
    const out = await apiSend<{ linkId: number }>("POST", "/api/me/gamertag-links", { serverId: 1, gamertag: "X" });
    expect(out.linkId).toBe(1);
    const [, init] = f.mock.calls[0]!;
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ serverId: 1, gamertag: "X" });
  });
});

describe("ApiError", () => {
  it("is an Error subclass", () => {
    const e = new ApiError(409, "already_verified");
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(409);
    expect(e.code).toBe("already_verified");
  });
});
