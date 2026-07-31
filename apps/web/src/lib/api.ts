import type {
  SiteStats,
  Server, RosterEntry, Profile, Life, LifeDetail, LeaderRow, Kill, Build,
  Me, GamertagLink, ClaimResult, PlayerPage,
  GlobalRosterEntry, GlobalLeaderRow, AuthMethods, SurvivorsPage, LifeTimelineData,
  ObituariesFeed, ObituaryArticle,
  NotificationsFeed,
  LifeTrack,
  SitemapData,
  MapShare,
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
/** Tier 2 of the map-resolution rule. Returns `{ slug: null }` (200) for a signed-out viewer —
 *  it is a hint, not a protected resource. Takes no subject; the session is the only input. */
export const getLastPlayedMap = () => apiGet<{ slug: string | null }>("/api/me/last-map");
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
export const createCheckout = () => apiSend<{ url: string }>("POST", "/api/me/tokens/checkout", {});
export const confirmCheckout = (sessionId: string) =>
  apiSend<{ granted: number; paid: boolean; balance: number }>("POST", "/api/me/tokens/checkout/confirm", {
    sessionId,
  });

/** How many people the viewer referred who went on to verify. Takes no subject — session only. */
export const getReferralCount = () => apiGet<{ joined: number }>("/api/me/referrals");
/** Called server-side by the same-origin claim handler, which holds the httpOnly invite cookie. */
export const postReferrerClaim = (referrerSlug: string) =>
  apiSend<{ ok: true; claimed: boolean }>("POST", "/api/me/referrer/claim", { referrerSlug });

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

/** ⚠️ `slug` is REQUIRED — there is no combined board. A life is per-server, so a cross-server
 *  board would rank lives that were never in the same race. */
export const getSurvivors = (p: { slug: string; page: number }) =>
  apiGet<SurvivorsPage>(`/api/survivors/${encodeURIComponent(p.slug)}?page=${p.page}`);

export const getObituariesFeed = (page: number) =>
  apiGet<ObituariesFeed>(`/api/obituaries?page=${page}`);
export const getObituary = (slug: string) =>
  getOrNull<ObituaryArticle>(`/api/obituaries/${encodeURIComponent(slug)}`);

/** Home's pitch feeds — public, cookie-independent, fetched on EVERY home render (cold AND
 *  signed-in, since the unverified pitch needs them too). `apiGetCached` keeps that free: no
 *  cookie forwarding, shared 60s fetch cache. Do NOT point authenticated surfaces at these. */
const HOME_FEED_REVALIDATE_SECONDS = 60;
export const getSiteStatsCached = () => apiGetCached<SiteStats>("/api/stats", HOME_FEED_REVALIDATE_SECONDS);
export const getObituariesFeedCached = (page: number) =>
  apiGetCached<ObituariesFeed>(`/api/obituaries?page=${page}`, HOME_FEED_REVALIDATE_SECONDS);

/** Sitemap-only. Shares `revalidate` with `sitemap.ts` (kept in sync by hand — both currently
 *  3600) so the fetch cache and the route's own ISR window agree. */
const SITEMAP_REVALIDATE_SECONDS = 3600;
export const getSitemapData = () => apiGetCached<SitemapData>("/api/sitemap", SITEMAP_REVALIDATE_SECONDS);
/** Sitemap-only variant of `getServers()` — same endpoint, but cacheable/cookie-free. Do NOT
 *  point the regular `getServers()` (used by authenticated RSC pages) at this. */
export const getServersCached = () => apiGetCached<Server[]>("/api/servers", SITEMAP_REVALIDATE_SECONDS);

/** ⚠️ These three name a GRANTEE, which does not breach the no-subject rule: that rule governs
 *  coordinate EGRESS (whose position you may READ). These say who may see YOUR position, and
 *  disclose nothing in their responses. */
export const shareLocationWith = (mapSlug: string, gamertag: string) =>
  apiSend<{ ok: true }>("POST", `/api/me/maps/${encodeURIComponent(mapSlug)}/shares`, { gamertag });
export const stopSharingWith = (mapSlug: string, gamertag: string) =>
  apiSend<{ ok: true }>("DELETE", `/api/me/maps/${encodeURIComponent(mapSlug)}/shares/${encodeURIComponent(gamertag)}`);
export const stopSharingAll = (mapSlug: string) =>
  apiSend<{ ok: true }>("DELETE", `/api/me/maps/${encodeURIComponent(mapSlug)}/shares`);

export const getMapShare = (slug: string) =>
  apiGet<MapShare>(`/api/me/maps/${encodeURIComponent(slug)}`);

/** Session-gated, `no-store, private` — the viewer's own avatar hash, or null. Never derive an
 *  avatar from `useSession()`'s `user.image`: that's the raw provider URL, and public surfaces
 *  must not hotlink it.
 *
 *  ⚠️ The one exception is `AvatarPanel`'s "Use my Discord photo" preview
 *  (`components/account/avatar-panel.tsx`), and it is narrow enough not to reopen this rule: it
 *  renders `user.image` only to the signed-in owner, on the owner's own session-gated dialog,
 *  purely as a staged preview — the value is never persisted or forwarded anywhere (the actual
 *  photo comes from a server-side `syncAvatar()` fetch on Save, not from this URL) and never
 *  reaches an unauthenticated viewer. "Public surfaces must not hotlink it" is the rule this
 *  guards; a private owner-only preview of the owner's own value doesn't hotlink it to anyone. */
export const getAvatar = () => apiGet<{ hash: string | null }>("/api/me/avatar");

/**
 * Multipart upload — deliberately NOT routed through `apiSend`/`apiGet`: those always attach a
 * `content-type: application/json` header (when a body is present) and JSON-encode the body,
 * neither of which is right for a file. A raw `fetch` with a `FormData` body lets the browser
 * set its own `multipart/form-data; boundary=...` content-type; setting one by hand here would
 * omit the boundary and the server could never split the parts.
 */
export async function uploadAvatar(file: File): Promise<{ hash: string }> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("/api/me/avatar", { method: "POST", body, credentials: "include", cache: "no-store" });
  return parse<{ hash: string }>(res);
}

/** Pulls the login provider's avatar image and stores it as the user's avatar. 409
 *  `no_provider_image` when the provider gave us nothing to pull. */
export const syncAvatar = () => apiSend<{ hash: string }>("POST", "/api/me/avatar/sync");

/** Bodyless DELETE: `apiSend` only sets content-type when a body is present. */
export const removeAvatar = () => apiSend<{ ok: true }>("DELETE", "/api/me/avatar");
