import { createHmac } from "node:crypto";
import type { ObituaryPost } from "../post.js";
import { RateLimitError } from "../rate-limit.js";

/** ⚠️ X counts EVERY url as 23 characters, whatever its actual length (t.co wrapping), so the
 *  budget is fixed and does not vary with the slug. 280 - 23 - 4 (two "\n\n") = 253 for the
 *  headline and lede together. */
const TEXT_BUDGET = 280 - 23 - 4;

/** Below this, a trimmed lede says nothing worth the characters — drop it and let the OG card
 *  carry the story rather than posting a headline followed by a near-bare ellipsis. */
const MIN_LEDE = 24;

/** Code points, not X's weighted count (which charges 2 for CJK and emoji). The copy is English
 *  and the budget carries margin — a deliberate simplification, not an oversight. */
const len = (s: string): number => Array.from(s).length;
const cut = (s: string, n: number): string => Array.from(s).slice(0, n).join("");

/** Trim to `budget` code points INCLUDING the ellipsis, cutting at the last whole word. */
function trimToWord(s: string, budget: number): string {
  const slice = cut(s, budget - 1);
  const lastSpace = slice.lastIndexOf(" ");
  const body = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${body.replace(/[\s,;:.!?-]+$/u, "")}…`;
}

/** Unlike Facebook — where the url rides in a separate `link` field and length never binds —
 *  on X the url must be in the post text, so the body has to be made to fit 280. */
export function buildXText(post: ObituaryPost): string {
  const join = (...parts: string[]): string => parts.join("\n\n");
  if (len(post.headline) > TEXT_BUDGET) return join(trimToWord(post.headline, TEXT_BUDGET), post.url);

  const ledeBudget = TEXT_BUDGET - len(post.headline);
  if (len(post.lede) <= ledeBudget) return join(post.headline, post.lede, post.url);
  if (ledeBudget < MIN_LEDE) return join(post.headline, post.url);
  return join(post.headline, trimToWord(post.lede, ledeBudget), post.url);
}

const TWEETS_URL = "https://api.x.com/2/tweets";

export type XCredentials = {
  apiKey: string; apiSecret: string; accessToken: string; accessSecret: string;
};

/** RFC 3986 percent-encoding. ⚠️ Stricter than encodeURIComponent, which leaves !*'() alone —
 *  and an under-escaped signature base string produces a valid-looking header that 401s. */
const enc = (s: string): string =>
  encodeURIComponent(s).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** OAuth 1.0a, chosen because these four credentials never expire — operationally identical to
 *  the Facebook page token. OAuth 2.0's refresh token rotates on every use and would need
 *  durable storage plus a manual browser re-auth whenever a write raced.
 *
 *  ⚠️ The request body is JSON and there is no query string, so ONLY the oauth_* params are
 *  signed. Including the body here (as a form-encoded request would) yields a 401. */
export function buildAuthHeader(
  creds: XCredentials, nonce: string, timestamp: number,
): string {
  const params: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestamp),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };
  const pairs = (o: Record<string, string>): string[] =>
    Object.keys(o).sort().map((k) => `${enc(k)}=${enc(o[k]!)}`);
  const base = ["POST", enc(TWEETS_URL), enc(pairs(params).join("&"))].join("&");
  const key = `${enc(creds.apiSecret)}&${enc(creds.accessSecret)}`;
  const signature = createHmac("sha1", key).update(base).digest("base64");
  const signed: Record<string, string> = { ...params, oauth_signature: signature };
  return `OAuth ${Object.keys(signed).sort().map((k) => `${enc(k)}="${enc(signed[k]!)}"`).join(", ")}`;
}

export async function postToX(
  fetchFn: typeof fetch, creds: XCredentials, post: ObituaryPost, nonce: string, timestamp: number,
): Promise<void> {
  const res = await fetchFn(TWEETS_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: buildAuthHeader(creds, nonce, timestamp),
    },
    body: JSON.stringify({ text: buildXText(post) }),
  });
  // 429 is throttling, not failure — a distinct type so the tick can back off without
  // spending one of the row's 5 attempts.
  if (res.status === 429) throw new RateLimitError(`x tweets 429: ${await res.text()}`);
  if (!res.ok) throw new Error(`x tweets ${res.status}: ${await res.text()}`);
}
