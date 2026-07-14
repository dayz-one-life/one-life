import type {
  Server, RosterEntry, Profile, Life, LifeDetail, LeaderRow, Kill, Build,
  Me, GamertagLink, ClaimResult, PlayerAggregate,
  GlobalRosterEntry, GlobalLeaderRow,
} from "./types";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? `${status} ${code}`);
    this.name = "ApiError";
  }
}

const isServer = typeof window === "undefined";
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:3001";

/**
 * Backend mounts Better Auth under /api/auth but read/me/gamertag routes at root.
 * The client goes through the Next rewrite (which does this mapping itself), so
 * this is only used to build the absolute server-side URL.
 */
export function toBackendPath(p: string): string {
  if (p === "/api/auth" || p.startsWith("/api/auth/")) return p;
  if (p.startsWith("/api/")) return p.slice(4); // "/api/servers" -> "/servers"
  return p;
}

/** Server-side: absolute URL to the API origin (rewrites don't apply to server fetch). */
async function buildInit(base: RequestInit): Promise<{ url: (p: string) => string; init: RequestInit }> {
  if (isServer) {
    // Forward the incoming request's cookies so RSC fetches are authenticated.
    const { cookies } = await import("next/headers");
    const cookieHeader = (await cookies()).toString();
    return {
      url: (p) => `${API_ORIGIN}${toBackendPath(p)}`,
      init: { ...base, cache: "no-store", headers: { ...base.headers, cookie: cookieHeader } },
    };
  }
  return { url: (p) => p, init: { ...base, credentials: "include" } };
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      if (!res.ok) throw new ApiError(res.status, "http_error", text.slice(0, 200));
      throw new ApiError(res.status, "invalid_response", "Response was not valid JSON");
    }
  }
  if (!res.ok) {
    const code = (json && typeof json === "object" && "error" in json) ? String((json as { error: unknown }).error) : "http_error";
    const message = (json && typeof json === "object" && "message" in json) ? String((json as { message: unknown }).message) : undefined;
    throw new ApiError(res.status, code, message);
  }
  return json as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  const { url, init } = await buildInit({ method: "GET" });
  return parse<T>(await fetch(url(path), init));
}

export async function apiSend<T>(method: "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  const { url, init } = await buildInit({
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return parse<T>(await fetch(url(path), init));
}

export const getServers = () => apiGet<Server[]>("/api/servers");
export const getRoster = (serverId: number) => apiGet<RosterEntry[]>(`/api/servers/${serverId}/roster`);
export const getProfile = (serverId: number, gamertag: string) =>
  apiGet<Profile>(`/api/servers/${serverId}/players/${encodeURIComponent(gamertag)}`);
export const getLives = (serverId: number, gamertag: string) =>
  apiGet<Life[]>(`/api/servers/${serverId}/players/${encodeURIComponent(gamertag)}/lives`);
export const getLifeDetail = (serverId: number, lifeId: number) =>
  apiGet<LifeDetail>(`/api/servers/${serverId}/lives/${lifeId}`);
export const getLeaderboard = (serverId: number, board: string) =>
  apiGet<LeaderRow[]>(`/api/servers/${serverId}/leaderboards/${board}`);
export const getGlobalRoster = () => apiGet<GlobalRosterEntry[]>(`/api/roster`);
export const getGlobalBoard = (board: string) => apiGet<GlobalLeaderRow[]>(`/api/leaderboards/${board}`);
export const getKills = (serverId: number) => apiGet<Kill[]>(`/api/servers/${serverId}/kills`);
export const getBuilds = (serverId: number) => apiGet<Build[]>(`/api/servers/${serverId}/builds`);
export const getMe = () => apiGet<Me>("/api/me");
export const getGamertagLinks = () => apiGet<GamertagLink[]>("/api/me/gamertag-links");
export const getGamertagLink = (id: number) => apiGet<GamertagLink>(`/api/me/gamertag-links/${id}`);
export const claimGamertag = (serverId: number, gamertag: string) =>
  apiSend<ClaimResult>("POST", "/api/me/gamertag-links", { serverId, gamertag });
export const cancelGamertagLink = (id: number) =>
  apiSend<{ status: string }>("DELETE", `/api/me/gamertag-links/${id}`);

export type TokenTransaction = { id: number; delta: number; kind: string; createdAt: string };
export type TokenWalletData = { balance: number; transactions: TokenTransaction[] };
export const getTokens = () => apiGet<TokenWalletData>("/api/me/tokens");
export const redeemToken = (banId?: number) =>
  apiSend<{ lifted: { banId: number; gamertag: string } }>("POST", "/api/me/tokens/redeem", banId ? { banId } : {});
export const transferToken = (toUserId: string) =>
  apiSend<{ ok: true }>("POST", "/api/me/tokens/transfer", { toUserId });
export const setReferrer = (referrerUserId: string) =>
  apiSend<{ ok: true }>("POST", "/api/me/referrer", { referrerUserId });

async function getOrNull<T>(path: string): Promise<T | null> {
  try {
    return await apiGet<T>(path);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export const getPlayerAggregate = (gamertag: string) =>
  getOrNull<PlayerAggregate>(`/api/players/${encodeURIComponent(gamertag)}`);
