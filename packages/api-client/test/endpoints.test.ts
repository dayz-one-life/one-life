import { describe, it, expect, vi } from "vitest";
import { createApiClient } from "../src/endpoints";
import { ApiError } from "../src/error";
import type { Transport } from "../src/transport";

function fakeTransport(overrides: Partial<Transport> = {}) {
  const get = vi.fn(async () => ({}) as never);
  const send = vi.fn(async () => ({}) as never);
  return { transport: { get, send, ...overrides } as Transport, get, send };
}

describe("createApiClient", () => {
  it("routes a plain GET to the transport with the literal path", async () => {
    const { transport, get } = fakeTransport();
    await createApiClient(transport).getServers();
    expect(get).toHaveBeenCalledWith("/api/servers");
  });

  it("URL-encodes interpolated path segments", async () => {
    const { transport, get } = fakeTransport();
    await createApiClient(transport).getProfile(3, "a b/c");
    expect(get).toHaveBeenCalledWith("/api/servers/3/players/a%20b%2Fc");
  });

  it("URL-encodes query parameters", async () => {
    const { transport, get } = fakeTransport();
    await createApiClient(transport).searchClaimableGamertags("a&b");
    expect(get).toHaveBeenCalledWith("/api/players/search?q=a%26b");
  });

  it("routes a POST with its body to the transport", async () => {
    const { transport, send } = fakeTransport();
    await createApiClient(transport).claimGamertag("tag");
    expect(send).toHaveBeenCalledWith("POST", "/api/me/gamertag-links", { gamertag: "tag" });
  });

  it("sends a bodyless DELETE as undefined, not as an empty object", async () => {
    const { transport, send } = fakeTransport();
    await createApiClient(transport).removeAvatar();
    expect(send).toHaveBeenCalledWith("DELETE", "/api/me/avatar");
  });

  it("omits the page query for page 1 of a player page, and includes it beyond", async () => {
    const { transport, get } = fakeTransport();
    const api = createApiClient(transport);
    await api.getPlayerPage("slug");
    expect(get).toHaveBeenCalledWith("/api/players/slug");
    await api.getPlayerPage("slug", 3);
    expect(get).toHaveBeenCalledWith("/api/players/slug?page=3");
  });

  it("turns a 404 into null for the getOrNull endpoints", async () => {
    const get = vi.fn(async () => { throw new ApiError(404, "not_found"); });
    const api = createApiClient({ get, send: vi.fn() } as unknown as Transport);
    await expect(api.getPlayerPage("gone")).resolves.toBeNull();
  });

  it("rethrows a non-404 from a getOrNull endpoint (a 403 must not read as absent)", async () => {
    const get = vi.fn(async () => { throw new ApiError(403, "forbidden"); });
    const api = createApiClient({ get, send: vi.fn() } as unknown as Transport);
    await expect(api.getLifeTrack("chernarus", 2)).rejects.toBeInstanceOf(ApiError);
  });

  it("defaults the notifications page to 1", async () => {
    const { transport, get } = fakeTransport();
    await createApiClient(transport).getNotifications();
    expect(get).toHaveBeenCalledWith("/api/me/notifications?page=1");
  });

  it("sends the account deletion confirmation as a DELETE body", async () => {
    const { transport, send } = fakeTransport();
    await createApiClient(transport).deleteAccount();
    expect(send).toHaveBeenCalledWith("DELETE", "/api/me", { confirm: "DELETE" });
  });

  it("asks for the version policy with no parameters", async () => {
    const { transport, get } = fakeTransport();
    await createApiClient(transport).getAppVersionPolicy();
    expect(get).toHaveBeenCalledWith("/api/app-version");
  });
});
