import type {
  Server, RosterEntry, Profile, Life, LifeDetail, LeaderRow, Kill, Build,
  Me, GamertagLink, ClaimResult, PlayerPage, PlayerArticlesFeed,
  GlobalRosterEntry, GlobalLeaderRow, AuthMethods, SurvivorSort, SurvivorsPage, LifeTimelineData,
  ObituariesFeed, ObituaryArticle,
  BirthNoticesFeed, BirthNoticeArticle,
  AppNotification, NotificationsFeed,
  NewsFeed, NewsArticle, LifeTrack,
  SitemapData,
  FriendsFeed, FriendStatusDto,
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
  // Defence-in-depth (spec §3.3): every response here can carry `Cache-Control:
  // no-store, private` (e.g. the owner-only life track), and the browser's own HTTP
  // cache must never be the reason a stale/foreign response is served. `credentials:
  // "include"` alone doesn't disable caching.
  return { url: (p) => p, init: { ...base, credentials: "include", cache: "no-store" } };
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

/**
 * Cacheable server-side GET for routes that must NOT depend on the request (e.g. `sitemap.ts`,
 * which needs `revalidate` to actually mean something). `apiGet`/`buildInit` await `cookies()`
 * and set `cache: "no-store"`, which opts the whole route out of static generation — that's
 * correct for authenticated RSC fetches but defeats ISR here. This variant never touches
 * `cookies()` and uses `next: { revalidate }` instead, so Next can cache and re-serve the
 * response. It also never forwards a cookie header to the API — pointless for an anonymous
 * enumeration endpoint, and a cache-poisoning vector once the response IS shared across
 * requests. Client-side callers don't need this: browser fetches already only cache what the
 * browser/CDN choose to, and don't run through `buildInit`'s server branch at all.
 */
// Plain `fetch` has no default timeout, so an API that is merely slow — rather than cleanly
// refusing — hangs the promise indefinitely, and a caller's try/catch can never fire because the
// promise never settles. An explicit timeout makes a slow or unreachable API reject quickly, so
// `sitemap.ts`'s try/catch degrades to a partial sitemap exactly as it does for a clean HTTP
// error. (This mattered acutely when the sitemap was briefly a static/ISR route: `next build`
// prerendered it, the fetch hung, and Next's 60s x3 build-worker budget failed the WHOLE build.
// The route is `force-dynamic` now, so that specific trap is gone — but a hung request is still
// worth bounding.)
const CACHED_FETCH_TIMEOUT_MS = 10_000;

export async function apiGetCached<T>(path: string, revalidateSeconds: number): Promise<T> {
  const url = `${API_ORIGIN}${toBackendPath(path)}`;
  const res = await fetch(url, {
    method: "GET",
    next: { revalidate: revalidateSeconds },
    signal: AbortSignal.timeout(CACHED_FETCH_TIMEOUT_MS),
  });
  return parse<T>(res);
}

export async function apiSend<T>(method: "POST" | "DELETE" | "PATCH", path: string, body?: unknown): Promise<T> {
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

/** Owner-only. Wraps `getOrNull`, so a 404 (life does not exist) resolves to null. A 403
 *  (signed-in but not the verified owner) is NOT translated here — it rethrows, matching
 *  every other `getOrNull` wrapper in this file. Prefer `useLifeTrack` (`./use-life-track`)
 *  as the entry point: its `queryFn` is what catches the 403 and turns it into null so the
 *  UI doesn't distinguish "not found" from "not yours" for a stranger. A caller importing
 *  this function directly must handle the 403 itself. */
export const getLifeTrack = (mapSlug: string, n: number) =>
  getOrNull<LifeTrack>(`/api/me/lives/${encodeURIComponent(mapSlug)}/${n}/track`);

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

/** Sitemap-only. Shares `revalidate` with `sitemap.ts` (kept in sync by hand — both currently
 *  3600) so the fetch cache and the route's own ISR window agree. */
const SITEMAP_REVALIDATE_SECONDS = 3600;
export const getSitemapData = () => apiGetCached<SitemapData>("/api/sitemap", SITEMAP_REVALIDATE_SECONDS);
/** Sitemap-only variant of `getServers()` — same endpoint, but cacheable/cookie-free. Do NOT
 *  point the regular `getServers()` (used by authenticated RSC pages) at this. */
export const getServersCached = () => apiGetCached<Server[]>("/api/servers", SITEMAP_REVALIDATE_SECONDS);

export const getFriends = (page = 1) => apiGet<FriendsFeed>(`/api/me/friends?page=${page}`);
export const getFriendStatus = (gamertag: string) =>
  apiGet<FriendStatusDto>(`/api/me/friends/status?gamertag=${encodeURIComponent(gamertag)}`);
export const sendFriendRequest = (toGamertag: string) =>
  apiSend<{ id: number; status: string }>("POST", "/api/me/friends/requests", { toGamertag });
export const acceptFriendRequest = (id: number) =>
  apiSend<{ ok: true }>("POST", `/api/me/friends/${id}/accept`);
export const declineFriendRequest = (id: number) =>
  apiSend<{ ok: true }>("POST", `/api/me/friends/${id}/decline`);
// Bodyless DELETE: apiSend only sets content-type when a body is present, which is why
// this must not pass one — Fastify rejects an empty JSON body with a 400.
export const deleteFriendship = (id: number) =>
  apiSend<{ ok: true }>("DELETE", `/api/me/friends/${id}`);
export const patchFriendPresence = (id: number, body: { share?: boolean; notify?: boolean }) =>
  apiSend<{ ok: true }>("PATCH", `/api/me/friends/${id}/presence`, body);
export const patchPreferences = (body: { sharePresence?: boolean }) =>
  apiSend<{ sharePresence: boolean }>("PATCH", "/api/me/preferences", body);
