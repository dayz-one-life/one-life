import { describe, it, expect, vi } from "vitest";
import { buildDiscordPayload, postToDiscord } from "../src/channels/discord.js";
import { buildFacebookParams, postToFacebook } from "../src/channels/facebook.js";
import { buildRedditParams, postToReddit, createRedditTokenProvider } from "../src/channels/reddit.js";

const post = {
  headline: "RonaldRaygun552's Seventh Sakhal File Closes",
  lede: "He simply stopped being alive.",
  url: "https://dayzonelife.com/obituaries/ronaldraygun552-7",
};

describe("discord channel", () => {
  it("builds content as headline, lede, url separated by blank lines", () => {
    expect(buildDiscordPayload(post)).toEqual({
      content: "RonaldRaygun552's Seventh Sakhal File Closes\n\nHe simply stopped being alive.\n\nhttps://dayzonelife.com/obituaries/ronaldraygun552-7",
    });
  });

  it("POSTs JSON to the webhook and resolves on 204", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await postToDiscord(fetchFn, "https://discord.test/hook", post);
    expect(fetchFn).toHaveBeenCalledWith("https://discord.test/hook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildDiscordPayload(post)),
    });
  });

  it("throws with status and body text on a non-2xx response", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 }));
    await expect(postToDiscord(fetchFn, "https://discord.test/hook", post)).rejects.toThrow(/429.*rate limited/s);
  });
});

describe("facebook channel", () => {
  it("builds message (headline + lede, no url) and link params, without the token", () => {
    const params = buildFacebookParams(post);
    expect(params.get("message")).toBe("RonaldRaygun552's Seventh Sakhal File Closes\n\nHe simply stopped being alive.");
    expect(params.get("link")).toBe(post.url);
    expect(params.has("access_token")).toBe(false);
  });

  it("POSTs form-encoded to the page feed with the token in the body", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{"id":"1_2"}', { status: 200 }));
    await postToFacebook(fetchFn, "990", "tok-abc", post);
    const [calledUrl, init] = fetchFn.mock.calls[0]!;
    expect(calledUrl).toBe("https://graph.facebook.com/v21.0/990/feed");
    const body = init.body as URLSearchParams;
    expect(body.get("access_token")).toBe("tok-abc");
    expect(body.get("link")).toBe(post.url);
    expect(init.method).toBe("POST");
  });

  it("throws with status and body text on a Graph error", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{"error":{"message":"expired token"}}', { status: 400 }));
    await expect(postToFacebook(fetchFn, "990", "tok", post)).rejects.toThrow(/400.*expired token/s);
  });
});

describe("reddit channel", () => {
  const opts = { subreddit: "dayzonelife", userAgent: "onelife-crier/1.0 (+https://dayzonelife.com)" };
  const ok = () => new Response(JSON.stringify({ json: { errors: [], data: { url: "https://redd.it/abc" } } }), { status: 200 });

  it("builds a link post carrying the headline as the title and the obituary as the url", () => {
    const params = buildRedditParams(post, opts);
    expect(params.get("sr")).toBe("dayzonelife");
    expect(params.get("kind")).toBe("link");
    expect(params.get("title")).toBe(post.headline);
    expect(params.get("url")).toBe(post.url);
    expect(params.get("api_type")).toBe("json");
    // The lede is deliberately absent — a link post cannot carry it. See the spec.
    expect(params.get("text")).toBeNull();
  });

  it("omits flair_id entirely when no flair is configured", () => {
    expect(buildRedditParams(post, opts).has("flair_id")).toBe(false);
    expect(buildRedditParams(post, { ...opts, flairId: "f-1" }).get("flair_id")).toBe("f-1");
  });

  it("POSTs to the oauth host with the bearer token and a distinctive user agent", async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok());
    await postToReddit(fetchFn, "tok-abc", post, opts);
    const [calledUrl, init] = fetchFn.mock.calls[0]!;
    expect(calledUrl).toBe("https://oauth.reddit.com/api/submit");
    expect(init.headers.authorization).toBe("Bearer tok-abc");
    expect(init.headers["user-agent"]).toBe(opts.userAgent);
  });

  // ⚠️ THE invariant. Reddit reports RATELIMIT, SUBREDDIT_NOEXIST, DOMAIN_BANNED and a shadowban
  // as HTTP 200 with the error inside the body. Trusting res.ok — which is exactly what the
  // Discord and Facebook channels correctly do — would write posted_at for a post that never
  // existed, and findSyndicationTargets excludes that row forever. No retry, no error, no post.
  it("throws when a 200 response carries json.errors", async () => {
    const body = JSON.stringify({ json: { errors: [["RATELIMIT", "you are doing that too much", "ratelimit"]] } });
    const fetchFn = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
    await expect(postToReddit(fetchFn, "tok", post, opts)).rejects.toThrow(/RATELIMIT.*too much/s);
  });

  it("resolves on a 200 with an empty error list", async () => {
    await expect(postToReddit(vi.fn().mockResolvedValue(ok()), "tok", post, opts)).resolves.toBeUndefined();
  });

  it("still throws on an ordinary non-2xx", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 }));
    await expect(postToReddit(fetchFn, "tok", post, opts)).rejects.toThrow(/403.*Forbidden/s);
  });
});

describe("reddit token provider", () => {
  const creds = { clientId: "cid", clientSecret: "csec", refreshToken: "rtok", userAgent: "ua/1.0" };
  const tokenRes = (token: string, expiresIn = 3600) =>
    new Response(JSON.stringify({ access_token: token, expires_in: expiresIn, token_type: "bearer" }), { status: 200 });

  it("mints with the refresh_token grant and HTTP Basic app credentials", async () => {
    const fetchFn = vi.fn().mockResolvedValue(tokenRes("acc-1"));
    let clock = new Date("2026-08-04T00:00:00Z");
    const provider = createRedditTokenProvider({ fetchFn, creds, now: () => clock });
    expect(await provider()).toBe("acc-1");
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://www.reddit.com/api/v1/access_token");
    expect(init.headers.authorization).toBe(`Basic ${Buffer.from("cid:csec").toString("base64")}`);
    expect((init.body as URLSearchParams).get("grant_type")).toBe("refresh_token");
    expect((init.body as URLSearchParams).get("refresh_token")).toBe("rtok");
  });

  // The worker ticks every 60s and a token lasts an hour. Minting per post would be wasteful and
  // is itself rate-limited by Reddit.
  it("caches the token instead of minting once per call", async () => {
    const fetchFn = vi.fn().mockResolvedValue(tokenRes("acc-1"));
    let clock = new Date("2026-08-04T00:00:00Z");
    const provider = createRedditTokenProvider({ fetchFn, creds, now: () => clock });
    await provider();
    clock = new Date("2026-08-04T00:30:00Z");
    expect(await provider()).toBe("acc-1");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("re-mints once the cached token is near expiry", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(tokenRes("acc-1")).mockResolvedValueOnce(tokenRes("acc-2"));
    let clock = new Date("2026-08-04T00:00:00Z");
    const provider = createRedditTokenProvider({ fetchFn, creds, now: () => clock });
    await provider();
    clock = new Date("2026-08-04T00:59:30Z"); // inside the 60s safety margin
    expect(await provider()).toBe("acc-2");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("surfaces a failed mint rather than returning an empty token", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    const provider = createRedditTokenProvider({ fetchFn, creds, now: () => new Date() });
    await expect(provider()).rejects.toThrow(/401/);
  });
});
