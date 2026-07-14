import { describe, it, expect } from "vitest";
import { parseEmote } from "../src/index.js";

describe("parseEmote", () => {
  it("parses emote with item", () => {
    expect(parseEmote('12:56:51 | Player "Steveo12491" (id=D0= pos=<235.7, 2924.6, 107.3>) performed EmoteSitA with R12'))
      .toEqual({ gamertag: "Steveo12491", emote: "EmoteSitA", item: "R12", x: 235.7, y: 2924.6 });
  });
  it("parses emote without item", () => {
    expect(parseEmote('22:38:21 | Player "tds maverick12" (id=5F= pos=<1,2,3>) performed EmoteSurrender'))
      .toEqual({ gamertag: "tds maverick12", emote: "EmoteSurrender", item: null, x: 1, y: 2 });
  });
  it("returns null for non-emote lines", () => {
    expect(parseEmote('12:52:38 | Player "A" (id=A=) is connecting')).toBeNull();
  });
  it("captures position when present", () => {
    const r = parseEmote('12:00:00 | Player "N" (id=H= pos=<100.5, 200.25, 3>) performed EmoteSalute');
    expect(r).toMatchObject({ gamertag: "N", emote: "EmoteSalute", x: 100.5, y: 200.25 });
  });
  it("returns null coords when position absent", () => {
    const r = parseEmote('12:00:00 | Player "N" (id=H=) performed EmoteSalute');
    expect(r).toMatchObject({ x: null, y: null });
  });
});
