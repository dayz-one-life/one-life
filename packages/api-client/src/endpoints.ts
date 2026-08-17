import { ApiError } from "./error";
import type { Transport } from "./transport";
import type {
  Server, RosterEntry, Profile, Life, LifeDetail, LeaderRow, Kill, Build,
  Me, GamertagLink, ClaimResult, PlayerPage,
  GlobalRosterEntry, GlobalLeaderRow, AuthMethods, SurvivorsPage, LifeTimelineData,
  ObituariesFeed, ObituaryArticle,
  NotificationsFeed,
  LifeTrack,
  MapShare,
  TokenWalletData,
  AppVersionPolicy,
} from "./types";

export function createApiClient(t: Transport) {
  async function getOrNull<T>(path: string): Promise<T | null> {
    try {
      return await t.get<T>(path);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  }

  return {
    getAuthMethods: () => t.get<AuthMethods>("/api/auth/providers"),
    /**
     * The mobile app's launch check. ⚠️ This response type can never change shape
     * incompatibly: an app too old to understand it is precisely the app this endpoint
     * exists to reach, and it cannot be fixed by an update it will never be told to make.
     */
    getAppVersionPolicy: () => t.get<AppVersionPolicy>("/api/app-version"),
    getServers: () => t.get<Server[]>("/api/servers"),
    /** Tier 2 of the map-resolution rule. Returns `{ slug: null }` (200) for a signed-out viewer —
     *  it is a hint, not a protected resource. Takes no subject; the session is the only input. */
    getLastPlayedMap: () => t.get<{ slug: string | null }>("/api/me/last-map"),
    getRoster: (serverId: number) => t.get<RosterEntry[]>(`/api/servers/${serverId}/roster`),
    getProfile: (serverId: number, gamertag: string) =>
      t.get<Profile>(`/api/servers/${serverId}/players/${encodeURIComponent(gamertag)}`),
    getLives: (serverId: number, gamertag: string) =>
      t.get<Life[]>(`/api/servers/${serverId}/players/${encodeURIComponent(gamertag)}/lives`),
    getLifeDetail: (serverId: number, lifeId: number) =>
      t.get<LifeDetail>(`/api/servers/${serverId}/lives/${lifeId}`),
    getLeaderboard: (serverId: number, board: string) =>
      t.get<LeaderRow[]>(`/api/servers/${serverId}/leaderboards/${board}`),
    getGlobalRoster: () => t.get<GlobalRosterEntry[]>(`/api/roster`),
    getGlobalBoard: (board: string) => t.get<GlobalLeaderRow[]>(`/api/leaderboards/${board}`),
    getKills: (serverId: number) => t.get<Kill[]>(`/api/servers/${serverId}/kills`),
    getBuilds: (serverId: number) => t.get<Build[]>(`/api/servers/${serverId}/builds`),
    getMe: () => t.get<Me>("/api/me"),
    /** Permanently deletes the signed-in account. The session dies with it, so this is the last
     *  thing the connection returns. Player history (lives, deaths, obituaries) SURVIVES — it is
     *  keyed by gamertag, not by user. The literal "DELETE" is what the server checks. */
    deleteAccount: () =>
      t.send<{ ok: true; tokensForfeited: number; gamertagLinksRemoved: number }>(
        "DELETE", "/api/me", { confirm: "DELETE" },
      ),
    getGamertagLinks: () => t.get<GamertagLink[]>("/api/me/gamertag-links"),
    getGamertagLink: (id: number) => t.get<GamertagLink>(`/api/me/gamertag-links/${id}`),
    claimGamertag: (gamertag: string) =>
      t.send<ClaimResult>("POST", "/api/me/gamertag-links", { gamertag }),
    cancelGamertagLink: (id: number) =>
      t.send<{ status: string }>("DELETE", `/api/me/gamertag-links/${id}`),
    searchClaimableGamertags: (q: string) =>
      t.get<string[]>(`/api/players/search?q=${encodeURIComponent(q)}`),
    searchVerifiedGamertags: (q: string) =>
      t.get<string[]>(`/api/players/search/verified?q=${encodeURIComponent(q)}`),

    getTokens: () => t.get<TokenWalletData>("/api/me/tokens"),
    redeemToken: (banId?: number) =>
      t.send<{ lifted: { banId: number; gamertag: string } }>("POST", "/api/me/tokens/redeem", banId ? { banId } : {}),
    transferToken: (toGamertag: string) =>
      t.send<{ ok: true }>("POST", "/api/me/tokens/transfer", { toGamertag }),
    createCheckout: () => t.send<{ url: string }>("POST", "/api/me/tokens/checkout", {}),
    confirmCheckout: (sessionId: string) =>
      t.send<{ granted: number; paid: boolean; balance: number }>("POST", "/api/me/tokens/checkout/confirm", {
        sessionId,
      }),

    /** How many people the viewer referred who went on to verify. Takes no subject — session only. */
    getReferralCount: () => t.get<{ joined: number }>("/api/me/referrals"),
    /** Called server-side by the same-origin claim handler, which holds the httpOnly invite cookie. */
    postReferrerClaim: (referrerSlug: string) =>
      t.send<{ ok: true; claimed: boolean }>("POST", "/api/me/referrer/claim", { referrerSlug }),

    getNotifications: (page = 1) =>
      t.get<NotificationsFeed>(`/api/me/notifications?page=${page}`),
    markNotificationsRead: (ids: number[]) =>
      t.send<{ ok: true }>("POST", "/api/me/notifications/read", { ids }),
    getVapidKey: () => t.get<{ publicKey: string }>("/api/push/vapid-key"),
    subscribePush: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
      t.send<{ ok: true }>("POST", "/api/me/push-subscriptions", sub),
    unsubscribePush: (endpoint: string) =>
      t.send<{ ok: true }>("DELETE", "/api/me/push-subscriptions", { endpoint }),
    /** The server's view of this endpoint for the *session user*. The browser's PushSubscription
     *  survives sign-out, account switches and the notifier retiring the row, so it alone cannot
     *  tell the toggle whether push will actually arrive. */
    getPushStatus: (endpoint: string) =>
      t.get<{ active: boolean }>(`/api/me/push-subscriptions?endpoint=${encodeURIComponent(endpoint)}`),

    getPlayerPage: (slug: string, page?: number) =>
      getOrNull<PlayerPage>(`/api/players/${encodeURIComponent(slug)}${page && page > 1 ? `?page=${page}` : ""}`),

    getPlayerLife: (slug: string, map: string, n: number) =>
      getOrNull<LifeTimelineData>(`/api/players/${encodeURIComponent(slug)}/${encodeURIComponent(map)}/lives/${n}`),

    /** Owner-only. Wraps `getOrNull`, so a 404 (life does not exist) resolves to null. A 403
     *  (signed-in but not the verified owner) is NOT translated here — it rethrows, matching
     *  every other `getOrNull` wrapper in this file. Prefer `useLifeTrack`
     *  (`apps/web/src/lib/use-life-track`) as the entry point: its `queryFn` is what catches the
     *  403 and turns it into null so the UI doesn't distinguish "not found" from "not yours" for
     *  a stranger. A caller importing this function directly must handle the 403 itself. */
    getLifeTrack: (mapSlug: string, n: number) =>
      getOrNull<LifeTrack>(`/api/me/lives/${encodeURIComponent(mapSlug)}/${n}/track`),

    /** ⚠️ `slug` is REQUIRED — there is no combined board. A life is per-server, so a cross-server
     *  board would rank lives that were never in the same race. */
    getSurvivors: (p: { slug: string; page: number }) =>
      t.get<SurvivorsPage>(`/api/survivors/${encodeURIComponent(p.slug)}?page=${p.page}`),

    getObituariesFeed: (page: number) =>
      t.get<ObituariesFeed>(`/api/obituaries?page=${page}`),
    getObituary: (slug: string) =>
      getOrNull<ObituaryArticle>(`/api/obituaries/${encodeURIComponent(slug)}`),

    /** ⚠️ These three name a GRANTEE, which does not breach the no-subject rule: that rule governs
     *  coordinate EGRESS (whose position you may READ). These say who may see YOUR position, and
     *  disclose nothing in their responses. */
    shareLocationWith: (mapSlug: string, gamertag: string) =>
      t.send<{ ok: true }>("POST", `/api/me/maps/${encodeURIComponent(mapSlug)}/shares`, { gamertag }),
    stopSharingWith: (mapSlug: string, gamertag: string) =>
      t.send<{ ok: true }>("DELETE", `/api/me/maps/${encodeURIComponent(mapSlug)}/shares/${encodeURIComponent(gamertag)}`),
    stopSharingAll: (mapSlug: string) =>
      t.send<{ ok: true }>("DELETE", `/api/me/maps/${encodeURIComponent(mapSlug)}/shares`),

    getMapShare: (slug: string) =>
      t.get<MapShare>(`/api/me/maps/${encodeURIComponent(slug)}`),

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
    getAvatar: () => t.get<{ hash: string | null }>("/api/me/avatar"),

    /** Pulls the login provider's avatar image and stores it as the user's avatar. 409
     *  `no_provider_image` when the provider gave us nothing to pull. */
    syncAvatar: () => t.send<{ hash: string }>("POST", "/api/me/avatar/sync"),

    /** Bodyless DELETE: transports only set content-type when a body is present. */
    removeAvatar: () => t.send<{ ok: true }>("DELETE", "/api/me/avatar"),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

// `SiteStats` and `SitemapData` have no endpoint here on purpose: their only callers are the web
// app's ISR-cached variants (`getSiteStatsCached`, `getSitemapData`), which depend on Next's
// `next: { revalidate }` fetch option and therefore stay in apps/web. Both types are still
// exported from ./types for those callers.
