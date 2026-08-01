import { describe, it, expect, vi } from "vitest";
import { buildDiscordPayload, postToDiscord } from "../src/channels/discord.js";
import { buildFacebookParams, postToFacebook } from "../src/channels/facebook.js";
import { buildXText, buildAuthHeader, postToX, type XCredentials } from "../src/channels/x.js";
import { RateLimitError } from "../src/rate-limit.js";

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

describe("x post body", () => {
  const url = "https://dayzonelife.com/obituaries/ronaldraygun552-7";
  // X counts every URL as 23 characters regardless of length, so the real string's length
  // is irrelevant to the budget — these tests assert against the 23-char accounting.
  const weighted = (text: string): number => Array.from(text).length - Array.from(url).length + 23;

  it("posts headline, lede and url in full when they fit — identical to the discord body", () => {
    expect(buildXText(post)).toBe(
      "RonaldRaygun552's Seventh Sakhal File Closes\n\nHe simply stopped being alive.\n\nhttps://dayzonelife.com/obituaries/ronaldraygun552-7",
    );
  });

  it("trims a long lede at a whole-word boundary and marks it with an ellipsis", () => {
    // headline is 44 code points, so the lede budget is 253 - 44 = 209.
    // A 299-char lede of 60 "word"s trims to the 41 whole words that fit (204 chars) + "…".
    const long = { ...post, lede: Array(60).fill("word").join(" ") };
    const text = buildXText(long);
    expect(text).toBe(`${post.headline}\n\n${Array(41).fill("word").join(" ")}…\n\n${url}`);
    expect(weighted(text)).toBeLessThanOrEqual(280);
  });

  it("never splits a word", () => {
    const long = { ...post, lede: Array(60).fill("word").join(" ") };
    const lede = buildXText(long).split("\n\n")[1]!;
    expect(lede.replace("…", "").split(" ").every((w) => w === "word")).toBe(true);
  });

  it("drops the lede entirely when the fragment that would fit is under 24 characters", () => {
    // A 240-char headline leaves 13 for the lede — too little to say anything.
    const cramped = { ...post, headline: "h".repeat(240) };
    const text = buildXText(cramped);
    expect(text).toBe(`${"h".repeat(240)}\n\n${url}`);
    expect(text).not.toContain("…");
    expect(weighted(text)).toBeLessThanOrEqual(280);
  });

  it("truncates a headline that alone exceeds the budget, and drops the lede", () => {
    const huge = { ...post, headline: "h".repeat(300) };
    const text = buildXText(huge);
    expect(text).toBe(`${"h".repeat(252)}…\n\n${url}`);
    expect(weighted(text)).toBeLessThanOrEqual(280);
  });
});

describe("x channel", () => {
  // Distinctive multi-character values on purpose: the secrets are asserted ABSENT from the
  // header, and a two-letter sentinel like "cs" could appear by chance inside a base64
  // signature and make the test flaky.
  const creds: XCredentials = {
    apiKey: "consumer-key", apiSecret: "SECRET-consumer",
    accessToken: "access-token", accessSecret: "SECRET-access",
  };

  it("builds an OAuth 1.0a header carrying the public params and never the secrets", () => {
    const header = buildAuthHeader(creds, "nonce123", 1_754_000_000);
    expect(header).toMatch(/^OAuth /);
    expect(header).toContain('oauth_consumer_key="consumer-key"');
    expect(header).toContain('oauth_nonce="nonce123"');
    expect(header).toContain('oauth_signature_method="HMAC-SHA1"');
    expect(header).toContain('oauth_timestamp="1754000000"');
    expect(header).toContain('oauth_token="access-token"');
    expect(header).toContain('oauth_version="1.0"');
    expect(header).toMatch(/oauth_signature="[^"]+"/);
    // The two secrets are signing keys — they must never be transmitted.
    expect(header).not.toContain("SECRET-consumer");
    expect(header).not.toContain("SECRET-access");
  });

  it("produces the exact signature for these inputs, derived independently from RFC 5849", () => {
    // ⚠️ This value was NOT obtained by running buildAuthHeader and pasting its output — that
    // would pin whatever the code does, bug included, and a dropped "&" in the signing key or an
    // encodeURIComponent-for-RFC-3986 swap would silently keep passing forever (every other
    // assertion in this file is self-referential: existence, determinism, and inequality under a
    // changed nonce, none of which pin a VALUE). Instead this was computed by a from-scratch
    // Python implementation of OAuth 1.0a signing (hmac/hashlib + urllib.parse.quote), verified
    // first against Twitter's own published worked example
    // (https://developer.x.com/en/docs/authentication/oauth-1-0a/creating-a-signature, expected
    // signature "hCtSmYh+iHYCEqBWrE7C7hYmtUk=") before being pointed at this test's fixture
    // (creds above, nonce "nonce123", timestamp 1_754_000_000). A signing regression that changes
    // the VALUE — not just breaks well-formedness — will only be caught here.
    const header = buildAuthHeader(creds, "nonce123", 1_754_000_000);
    // "=" is percent-encoded to "%3D" inside the quoted header value.
    expect(header).toContain('oauth_signature="7qENkaP64HOjGEY6w0KPvl5v0MU%3D"');
  });

  it("signs deterministically, and a different nonce yields a different signature", () => {
    const a = buildAuthHeader(creds, "nonce123", 1_754_000_000);
    expect(buildAuthHeader(creds, "nonce123", 1_754_000_000)).toBe(a);
    expect(buildAuthHeader(creds, "nonce999", 1_754_000_000)).not.toBe(a);
    expect(buildAuthHeader(creds, "nonce123", 1_754_000_001)).not.toBe(a);
  });

  it("POSTs JSON to /2/tweets with the fitted text and the signature in the header", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{"data":{"id":"1"}}', { status: 201 }));
    await postToX(fetchFn, creds, post, "nonce123", 1_754_000_000);
    const [calledUrl, init] = fetchFn.mock.calls[0]!;
    expect(calledUrl).toBe("https://api.x.com/2/tweets");
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.headers.authorization).toBe(buildAuthHeader(creds, "nonce123", 1_754_000_000));
    expect(JSON.parse(init.body)).toEqual({ text: buildXText(post) });
    // Credentials must never reach the query string, where proxies log them.
    expect(String(calledUrl)).not.toContain("consumer-key");
    expect(String(calledUrl)).not.toContain("?");
  });

  it("throws RateLimitError — not a plain Error — on a 429", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("Too Many Requests", { status: 429 }));
    await expect(postToX(fetchFn, creds, post, "n", 1)).rejects.toBeInstanceOf(RateLimitError);
  });

  it("throws a plain Error with status and body text on any other non-2xx", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{"title":"Unauthorized"}', { status: 401 }));
    const err = await postToX(fetchFn, creds, post, "n", 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(RateLimitError);
    expect((err as Error).message).toMatch(/401.*Unauthorized/s);
  });
});
