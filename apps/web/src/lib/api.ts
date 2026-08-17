import {
  ApiError,
  createApiClient,
  parse,
  toBackendPath,
  type Transport,
} from "@onelife/api-client";
import type {
  SiteStats, Server, LifeTimelineData, ObituariesFeed, ObituaryArticle, SitemapData,
} from "./types";

// Re-exported so the ~53 modules importing these from "@/lib/api" keep working unchanged.
export { ApiError, toBackendPath };
export type { TokenTransaction, TokenWalletData } from "./types";

const isServer = typeof window === "undefined";
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:3001";

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

/** The web app's transport: cookie-forwarding server-side, `credentials: "include"` in the
 *  browser. The mobile client supplies a bearer-token transport against the same interface. */
const webTransport: Transport = { get: apiGet, send: apiSend };

const api = createApiClient(webTransport);

// ── The shared catalog, re-exported one by one so every existing `import { getX } from
//    "@/lib/api"` keeps resolving. Do not collapse this into `export const { ... } = api` —
//    named re-exports are what keep the call sites and their types stable. ──
export const getAuthMethods = api.getAuthMethods;
export const getServers = api.getServers;
export const getLastPlayedMap = api.getLastPlayedMap;
export const getRoster = api.getRoster;
export const getProfile = api.getProfile;
export const getLives = api.getLives;
export const getLifeDetail = api.getLifeDetail;
export const getLeaderboard = api.getLeaderboard;
export const getGlobalRoster = api.getGlobalRoster;
export const getGlobalBoard = api.getGlobalBoard;
export const getKills = api.getKills;
export const getBuilds = api.getBuilds;
export const getMe = api.getMe;
export const getGamertagLinks = api.getGamertagLinks;
export const getGamertagLink = api.getGamertagLink;
export const claimGamertag = api.claimGamertag;
export const cancelGamertagLink = api.cancelGamertagLink;
export const searchClaimableGamertags = api.searchClaimableGamertags;
export const searchVerifiedGamertags = api.searchVerifiedGamertags;
export const getTokens = api.getTokens;
export const redeemToken = api.redeemToken;
export const transferToken = api.transferToken;
export const createCheckout = api.createCheckout;
export const confirmCheckout = api.confirmCheckout;
export const getReferralCount = api.getReferralCount;
export const postReferrerClaim = api.postReferrerClaim;
export const getNotifications = api.getNotifications;
export const markNotificationsRead = api.markNotificationsRead;
export const getVapidKey = api.getVapidKey;
export const subscribePush = api.subscribePush;
export const unsubscribePush = api.unsubscribePush;
export const getPushStatus = api.getPushStatus;
export const getPlayerPage = api.getPlayerPage;
export const getPlayerLife = api.getPlayerLife;
export const getLifeTrack = api.getLifeTrack;
export const getSurvivors = api.getSurvivors;
export const getObituariesFeed = api.getObituariesFeed;
export const getObituary = api.getObituary;
export const shareLocationWith = api.shareLocationWith;
export const stopSharingWith = api.stopSharingWith;
export const stopSharingAll = api.stopSharingAll;
export const getMapShare = api.getMapShare;
export const getAvatar = api.getAvatar;
export const syncAvatar = api.syncAvatar;
export const removeAvatar = api.removeAvatar;

// ── Next-only variants below. These depend on `next: { revalidate }` and have no mobile
//    equivalent, so they stay here rather than moving into @onelife/api-client. ──

/** `getOrNull`'s 404-to-null contract over the cookie-free, cacheable fetch. */
async function getOrNullCached<T>(path: string, revalidateSeconds: number): Promise<T | null> {
  try {
    return await apiGetCached<T>(path, revalidateSeconds);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** Home's pitch feeds — public, cookie-independent, fetched on EVERY home render (cold AND
 *  signed-in, since the unverified pitch needs them too). `apiGetCached` keeps that free: no
 *  cookie forwarding, shared 60s fetch cache. Do NOT point authenticated surfaces at these. */
const HOME_FEED_REVALIDATE_SECONDS = 60;
/** ⚠️ Stays on the SIGNAL-BOUND `apiGetCached`: this feeds `/opengraph-image` and
 *  `/obituaries/opengraph-image`, both segment-less and therefore PRERENDERED by `next build`
 *  against an API that isn't serving. Without the bound the build hangs and fails. */
export const getSiteStatsCached = () => apiGetCached<SiteStats>("/api/stats", HOME_FEED_REVALIDATE_SECONDS);
export const getObituariesFeedCached = (page: number) =>
  apiGetCached<ObituariesFeed>(`/api/obituaries?page=${page}`, HOME_FEED_REVALIDATE_SECONDS);

/**
 * ⚠️ The obituary PAGE and its colocated `opengraph-image` must read through these, not through
 * `getObituary`/`getPlayerLife`. `apiGet` awaits `cookies()`, which opts the whole route out of
 * static rendering, and Next then emits `cache-control: private, no-cache, no-store` — so a CDN
 * cannot serve it and EVERY social-crawler scrape becomes a cold origin render (API fetch, font
 * load, PNG encode). Facebook's scraper has a short timeout and its fleet was intermittently
 * getting 418/timeout back, which publishes the post with a blank card; the manual Sharing
 * Debugger scrape succeeded at the same moment, which is what made this look intermittent rather
 * than structural. An obituary is immutable once filed, so serving crawlers from the edge costs
 * nothing. Both endpoints are public (`/api/obituaries/*`, `/api/players/*`) — the owner-gated
 * life track is `getLifeTrack` on `/api/me/*` and this page never touches it.
 * Do NOT point authenticated surfaces at these: no cookie is forwarded, and the response IS
 * shared across requests, so anything session-shaped would leak between viewers.
 * `revalidate` is kept in sync BY HAND with the two route files that set their own window.
 */
export const OBITUARY_REVALIDATE_SECONDS = 300;
export const getObituaryCached = (slug: string) =>
  getOrNullCached<ObituaryArticle>(`/api/obituaries/${encodeURIComponent(slug)}`, OBITUARY_REVALIDATE_SECONDS);
export const getPlayerLifeCached = (slug: string, map: string, n: number) =>
  getOrNullCached<LifeTimelineData>(
    `/api/players/${encodeURIComponent(slug)}/${encodeURIComponent(map)}/lives/${n}`,
    OBITUARY_REVALIDATE_SECONDS,
  );

/** Sitemap-only. Shares `revalidate` with `sitemap.ts` (kept in sync by hand — both currently
 *  3600) so the fetch cache and the route's own ISR window agree. */
const SITEMAP_REVALIDATE_SECONDS = 3600;
export const getSitemapData = () => apiGetCached<SitemapData>("/api/sitemap", SITEMAP_REVALIDATE_SECONDS);
/** Sitemap-only variant of `getServers()` — same endpoint, but cacheable/cookie-free. Do NOT
 *  point the regular `getServers()` (used by authenticated RSC pages) at this. */
export const getServersCached = () => apiGetCached<Server[]>("/api/servers", SITEMAP_REVALIDATE_SECONDS);

/**
 * Multipart upload — deliberately NOT routed through `apiSend`/`apiGet`: those always attach a
 * `content-type: application/json` header (when a body is present) and JSON-encode the body,
 * neither of which is right for a file. A raw `fetch` with a `FormData` body lets the browser
 * set its own `multipart/form-data; boundary=...` content-type; setting one by hand here would
 * omit the boundary and the server could never split the parts.
 *
 * Stays in apps/web rather than moving to @onelife/api-client: it takes a DOM `File`, which
 * React Native does not have (RN's FormData takes `{ uri, name, type }` instead).
 */
export async function uploadAvatar(file: File): Promise<{ hash: string }> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("/api/me/avatar", { method: "POST", body, credentials: "include", cache: "no-store" });
  return parse<{ hash: string }>(res);
}
