import type {
  Server, RosterEntry, Profile, Life, LifeDetail, LeaderRow, Kill, Build,
  Me, GamertagLink, ClaimResult, PlayerPage, PlayerArticlesFeed,
  GlobalRosterEntry, GlobalLeaderRow, AuthMethods, SurvivorSort, SurvivorsPage, LifeTimelineData,
  ObituariesFeed, ObituaryArticle,
  BirthNoticesFeed, BirthNoticeArticle,
  AppNotification, NotificationsFeed,
  NewsFeed, NewsArticle,
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
  // Only send a content-type when there's actually a body. A bodyless request that still
  // declares `application/json` makes Fastify reject it with 400 (FST_ERR_CTP_EMPTY_JSON_BODY),
  // which is what broke the bodyless DELETE for cancelling a gamertag claim.
  const { url, init } = await buildInit({
    method,
    ...(body !== undefined
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  return parse<T>(await fetch(url(path), init));
}

export const getAuthMethods = () => apiGet<AuthMethods>("/api/auth/providers");
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
export const claimGamertag = (gamertag: string) =>
  apiSend<ClaimResult>("POST", "/api/me/gamertag-links", { gamertag });
export const cancelGamertagLink = (id: number) =>
  apiSend<{ status: string }>("DELETE", `/api/me/gamertag-links/${id}`);
export const searchClaimableGamertags = (q: string) =>
  apiGet<string[]>(`/api/players/search?q=${encodeURIComponent(q)}`);
export const searchVerifiedGamertags = (q: string) =>
  apiGet<string[]>(`/api/players/search/verified?q=${encodeURIComponent(q)}`);

export type TokenTransaction = { id: number; delta: number; kind: string; createdAt: string };
export type TokenWalletData = { balance: number; transactions: TokenTransaction[] };
export const getTokens = () => apiGet<TokenWalletData>("/api/me/tokens");
export const redeemToken = (banId?: number) =>
  apiSend<{ lifted: { banId: number; gamertag: string } }>("POST", "/api/me/tokens/redeem", banId ? { banId } : {});
export const transferToken = (toGamertag: string) =>
  apiSend<{ ok: true }>("POST", "/api/me/tokens/transfer", { toGamertag });
export const setReferrer = (referrerGamertag: string) =>
  apiSend<{ ok: true }>("POST", "/api/me/referrer", { referrerGamertag });

export const getNotifications = (page = 1) =>
  apiGet<NotificationsFeed>(`/api/me/notifications?page=${page}`);
export const markNotificationsRead = (ids: number[]) =>
  apiSend<{ ok: true }>("POST", "/api/me/notifications/read", { ids });
export const getVapidKey = () => apiGet<{ publicKey: string }>("/api/push/vapid-key");
export const subscribePush = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
  apiSend<{ ok: true }>("POST", "/api/me/push-subscriptions", sub);
export const unsubscribePush = (endpoint: string) =>
  apiSend<{ ok: true }>("DELETE", "/api/me/push-subscriptions", { endpoint });
/** The server's view of this endpoint for the *session user*. The browser's PushSubscription
 *  survives sign-out, account switches and the notifier retiring the row, so it alone cannot
 *  tell the toggle whether push will actually arrive. */
export const getPushStatus = (endpoint: string) =>
  apiGet<{ active: boolean }>(`/api/me/push-subscriptions?endpoint=${encodeURIComponent(endpoint)}`);

async function getOrNull<T>(path: string): Promise<T | null> {
  try {
    return await apiGet<T>(path);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export const getPlayerPage = (slug: string, page?: number) =>
  getOrNull<PlayerPage>(`/api/players/${encodeURIComponent(slug)}${page && page > 1 ? `?page=${page}` : ""}`);

/** Never 404s — the backend returns an empty feed for a player with no articles, and falls
 *  back to page 1 on a garbage `?page=`. */
export const getPlayerArticles = (slug: string, page: number) =>
  apiGet<PlayerArticlesFeed>(`/api/players/${encodeURIComponent(slug)}/articles?page=${page}`);

export const getPlayerLife = (slug: string, map: string, n: number) =>
  getOrNull<LifeTimelineData>(`/api/players/${encodeURIComponent(slug)}/${encodeURIComponent(map)}/lives/${n}`);

export const getSurvivors = (p: { slug?: string; sort: SurvivorSort; page: number }) =>
  apiGet<SurvivorsPage>(`/api/survivors${p.slug ? "/" + encodeURIComponent(p.slug) : ""}?sort=${p.sort}&page=${p.page}`);

export const getObituariesFeed = (page: number) =>
  apiGet<ObituariesFeed>(`/api/obituaries?page=${page}`);
export const getObituary = (slug: string) =>
  getOrNull<ObituaryArticle>(`/api/obituaries/${encodeURIComponent(slug)}`);

export const getBirthNoticesFeed = (page: number) =>
  apiGet<BirthNoticesFeed>(`/api/birth-notices?page=${page}`);
export const getBirthNotice = (slug: string) =>
  getOrNull<BirthNoticeArticle>(`/api/birth-notices/${encodeURIComponent(slug)}`);

export const getNewsFeed = (page: number) =>
  apiGet<NewsFeed>(`/api/news?page=${page}`);
export const getNewsArticle = (slug: string, preview?: string) =>
  getOrNull<NewsArticle>(
    `/api/news/${encodeURIComponent(slug)}${preview ? `?preview=${encodeURIComponent(preview)}` : ""}`,
  );
