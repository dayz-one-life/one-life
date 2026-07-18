import type { CompletionClient } from "./generate.js";

/** Minimal OpenRouter chat-completions call. Returns choices[0].message.content; throws on
 *  non-2xx or empty content. No SDK — global fetch (Node 20+). */
export async function openrouterComplete(args: {
  apiKey: string;
  model: string;
  system?: string;
  user: string;
  temperature?: number;
}): Promise<string> {
  const messages = [
    ...(args.system ? [{ role: "system" as const, content: args.system }] : []),
    { role: "user" as const, content: args.user },
  ];
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "One Life Newsdesk",
    },
    body: JSON.stringify({
      model: args.model,
      messages,
      temperature: args.temperature ?? 0.7,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = body?.error?.message ?? JSON.stringify(body);
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new Error(`OpenRouter request failed (${res.status}): ${detail}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new Error("OpenRouter returned empty completion content");
  }
  return content;
}

/** Adapt openrouterComplete to the injectable CompletionClient the generator/tick depend on. */
export function openrouterClient(cfg: { apiKey: string; model: string; temperature?: number }): CompletionClient {
  return {
    complete: ({ system, user }) =>
      openrouterComplete({ apiKey: cfg.apiKey, model: cfg.model, system, user, temperature: cfg.temperature }),
  };
}

export interface GeneratedImage { bytes: Buffer; contentType: string }

/** The injectable seam the image tick depends on (mirror of CompletionClient). Model is per-call
 *  so the tick can pick workhorse vs flagship; quality is fixed per deployment. */
export interface ImageClient { generate(req: { prompt: string; model: string }): Promise<GeneratedImage> }

/** OpenRouter unified image API. Returns raw bytes — the API only ever answers base64, never a
 *  hosted URL. gpt-image models accept no aspect/size/format params; canvas is model-default. */
export async function openrouterImage(args: {
  apiKey: string; model: string; prompt: string; quality: string;
}): Promise<GeneratedImage> {
  const res = await fetch("https://openrouter.ai/api/v1/images", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "One Life Newsdesk",
    },
    body: JSON.stringify({ model: args.model, prompt: args.prompt, quality: args.quality, n: 1 }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = body?.error?.message ?? JSON.stringify(body);
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new Error(`OpenRouter image request failed (${res.status}): ${detail}`);
  }
  const data = (await res.json()) as { data?: { b64_json?: string; media_type?: string }[] };
  const img = data?.data?.[0];
  if (!img?.b64_json) throw new Error("OpenRouter returned no image data");
  const bytes = Buffer.from(img.b64_json, "base64");
  if (bytes.length > 10_000_000) {
    throw new Error(`OpenRouter image exceeded the 10MB size cap (${bytes.length} bytes)`);
  }
  return { bytes, contentType: img.media_type ?? "image/png" };
}

export function openrouterImageClient(cfg: { apiKey: string; quality: string }): ImageClient {
  return {
    generate: ({ prompt, model }) => openrouterImage({ apiKey: cfg.apiKey, model, prompt, quality: cfg.quality }),
  };
}
