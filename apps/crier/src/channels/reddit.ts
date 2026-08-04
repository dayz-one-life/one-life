import type { ObituaryPost } from "../post.js";

const OAUTH = "https://oauth.reddit.com";
const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";

/** Re-mint this long before the stated expiry, so a token cannot lapse mid-request. */
const EXPIRY_MARGIN_MS = 60_000;

export type RedditPostOptions = { subreddit: string; userAgent: string; flairId?: string | null };

/** A LINK post: Reddit renders the obituary's OG card, and the click lands on the site.
 *
 *  The lede is deliberately absent — a link post cannot carry body text, and posting it as a
 *  follow-up comment was declined: that is a second call with its own failure mode, and the
 *  `syndications` row records exactly one outcome, so a post that succeeded with a failed comment
 *  could be neither recorded nor retried without double-posting. See the spec. */
export function buildRedditParams(post: ObituaryPost, opts: RedditPostOptions): URLSearchParams {
  const params = new URLSearchParams({
    sr: opts.subreddit,
    kind: "link",
    title: post.headline,
    url: post.url,
    api_type: "json",
    // Reddit would otherwise prompt-and-reject a URL already submitted to the sub; we want the
    // error, not a silent duplicate.
    resubmit: "false",
  });
  if (opts.flairId) params.set("flair_id", opts.flairId);
  return params;
}

export async function postToReddit(
  fetchFn: typeof fetch,
  accessToken: string,
  post: ObituaryPost,
  opts: RedditPostOptions,
): Promise<void> {
  const res = await fetchFn(`${OAUTH}/api/submit`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      // ⚠️ Reddit throttles generic and shared user agents hard. This must stay distinctive.
      "user-agent": opts.userAgent,
    },
    body: buildRedditParams(post, opts),
  });
  if (!res.ok) throw new Error(`reddit submit ${res.status}: ${await res.text()}`);

  // ⚠️ THE Reddit trap, and the one place the Discord/Facebook pattern does NOT transfer.
  // RATELIMIT, SUBREDDIT_NOEXIST, DOMAIN_BANNED and a shadowbanned account all come back as
  // HTTP **200** with the error inside the body. Trusting `res.ok` alone would record a success
  // and write `posted_at` for a post that never existed — and `findSyndicationTargets` excludes a
  // posted row forever, so there would be no retry, no error and no post. Parse the body.
  const body = (await res.json()) as { json?: { errors?: unknown[] } };
  const errors = body?.json?.errors ?? [];
  if (errors.length > 0) throw new Error(`reddit submit rejected: ${JSON.stringify(errors)}`);
}

export type RedditCreds = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  userAgent: string;
};

/**
 * Access tokens last an hour; the worker ticks every 60s. Minting one per post would be wasteful
 * and is itself rate-limited, so the provider caches until shortly before expiry.
 *
 * The durable credential is a REFRESH TOKEN, minted once by the operator through an
 * `authorization_code` flow with `duration=permanent`. The password grant was rejected: it fails
 * outright when the account has 2FA on, and turning 2FA off on an account that moderates the
 * subreddit is the worse trade. Unlike the Facebook page token this does not expire, so the
 * Facebook runbook's "revive poisoned rows after minting a new token" step has no equivalent here.
 *
 * `now` is injected so the cache is testable without timers.
 */
export function createRedditTokenProvider(deps: {
  fetchFn: typeof fetch;
  creds: RedditCreds;
  now: () => Date;
}): () => Promise<string> {
  let cached: { token: string; expiresAt: number } | null = null;

  return async () => {
    const nowMs = deps.now().getTime();
    if (cached && nowMs < cached.expiresAt - EXPIRY_MARGIN_MS) return cached.token;

    const { clientId, clientSecret, refreshToken, userAgent } = deps.creds;
    const res = await deps.fetchFn(TOKEN_URL, {
      method: "POST",
      headers: {
        // HTTP Basic with the app credentials — Reddit's documented scheme for this grant.
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "user-agent": userAgent,
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    });
    if (!res.ok) throw new Error(`reddit token ${res.status}: ${await res.text()}`);

    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error(`reddit token response carried no access_token`);
    cached = { token: body.access_token, expiresAt: nowMs + (body.expires_in ?? 3600) * 1000 };
    return cached.token;
  };
}
