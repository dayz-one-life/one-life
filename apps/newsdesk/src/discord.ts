/** Result of a single Discord webhook POST. */
export type DiscordPostResult =
  | { ok: true }
  | { ok: false; rateLimited: true; retryAfterSeconds: number }
  | { ok: false; rateLimited: false; error: string };

/** POST { content } to a Discord incoming webhook. Discord returns 204 on success. `fetch` is
 *  injected for testing. Mirrors openrouter.ts: global fetch, JSON body, !res.ok handling. */
export async function postToDiscordWebhook(
  webhookUrl: string,
  content: string,
  deps: { fetch: typeof fetch },
): Promise<DiscordPostResult> {
  let res: Response;
  try {
    res = await deps.fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
  } catch (e) {
    return { ok: false, rateLimited: false, error: e instanceof Error ? e.message : String(e) };
  }

  if (res.ok) return { ok: true }; // 204 No Content (and any 2xx)

  if (res.status === 429) {
    let retryAfterSeconds = 1;
    try {
      const body = (await res.json()) as { retry_after?: number };
      if (typeof body?.retry_after === "number") retryAfterSeconds = body.retry_after;
    } catch {
      // keep default
    }
    return { ok: false, rateLimited: true, retryAfterSeconds };
  }

  let detail = "";
  try {
    detail = await res.text();
  } catch {
    detail = "";
  }
  return { ok: false, rateLimited: false, error: `Discord webhook failed (${res.status}): ${detail}` };
}
