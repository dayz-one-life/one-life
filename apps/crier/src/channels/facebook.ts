import type { ObituaryPost } from "../post.js";

const GRAPH = "https://graph.facebook.com/v21.0";

/** message carries headline + lede only; the URL rides in `link`, which drives FB's OG unfurl. */
export function buildFacebookParams(post: ObituaryPost): URLSearchParams {
  return new URLSearchParams({ message: `${post.headline}\n\n${post.lede}`, link: post.url });
}

export async function postToFacebook(fetchFn: typeof fetch, pageId: string, token: string, post: ObituaryPost): Promise<void> {
  const body = buildFacebookParams(post);
  // Token in the form body, never the query string — query strings end up in proxy logs.
  body.set("access_token", token);
  const res = await fetchFn(`${GRAPH}/${pageId}/feed`, { method: "POST", body });
  if (!res.ok) throw new Error(`facebook feed ${res.status}: ${await res.text()}`);
}
