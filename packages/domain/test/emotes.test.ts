import { describe, it, expect } from "vitest";
import { emoteToken, safeVerificationEmotes, EMOTE_DICTIONARY, tokenToLabel } from "../src/index.js";

describe("emote dictionary", () => {
  it("maps menu labels to confirmed log tokens", () => {
    expect(emoteToken("salute")).toBe("EmoteSalute");
    expect(emoteToken("surrender")).toBe("EmoteSurrender");
    expect(emoteToken("greeting")).toBe("EmoteGreeting");
    expect(emoteToken("point at self")).toBe("EmotePointSelf");
    expect(emoteToken("thumbs down")).toBe("EmoteThumbDown");
  });

  it("excludes unsafe emotes from verification", () => {
    const safe = safeVerificationEmotes().map((e) => e.token);
    expect(safe).not.toContain("EmoteSuicide");
    expect(safe).not.toContain("EmoteVomit");
    expect(safe).not.toContain("EmoteSitA"); // too common in natural play
  });

  it("safe verification set has enough distinct emotes", () => {
    expect(safeVerificationEmotes().length).toBeGreaterThanOrEqual(15);
  });

  it("has no duplicate tokens", () => {
    const tokens = EMOTE_DICTIONARY.map((e) => e.token);
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});

describe("tokenToLabel", () => {
  it("maps a token back to its menu label", () => {
    expect(tokenToLabel("EmoteSalute")).toBe("salute");
  });
  it("returns undefined for an unknown token", () => {
    expect(tokenToLabel("EmoteNope")).toBeUndefined();
  });
});
