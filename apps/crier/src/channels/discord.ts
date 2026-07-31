import { postBody, type ObituaryPost } from "../post.js";

export function buildDiscordPayload(post: ObituaryPost): { content: string } {
  return { content: postBody(post) };
}

export async function postToDiscord(fetchFn: typeof fetch, webhookUrl: string, post: ObituaryPost): Promise<void> {
  const res = await fetchFn(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildDiscordPayload(post)),
  });
  if (!res.ok) throw new Error(`discord webhook ${res.status}: ${await res.text()}`);
}
