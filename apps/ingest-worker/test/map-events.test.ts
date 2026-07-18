import { describe, it, expect } from "vitest";
import type { ParsedLine } from "@onelife/adm-parser";
import { mapParsedToEvents } from "../src/map-events.js";

describe("mapParsedToEvents", () => {
  it("maps boot to server.rebooted", () => {
    const parsed: ParsedLine[] = [{ kind: "boot", localDateTime: "2026-07-06 12:51:59" }];
    expect(mapParsedToEvents(parsed)).toEqual([
      { type: "server.rebooted", payload: { localDateTime: "2026-07-06 12:51:59" } },
    ]);
  });
  it("maps a death + position pair preserving order", () => {
    const parsed: ParsedLine[] = [
      { kind: "death", victim: "V", dayzId: "V=", cause: "pvp", killer: "K", weapon: "M4A1", distance: 153.4, energy: null, water: null, bleedSources: null, deathEntity: null },
      { kind: "position", gamertag: "V", x: 1, y: 2 },
    ];
    const out = mapParsedToEvents(parsed);
    expect(out[0]!.type).toBe("player.died");
    expect(out[1]!.type).toBe("player.position");
  });
  it("maps emote", () => {
    const parsed: ParsedLine[] = [{ kind: "emote", gamertag: "S", emote: "EmoteSalute", item: null, x: null, y: null }];
    expect(mapParsedToEvents(parsed)).toEqual([
      { type: "emote.performed", payload: { gamertag: "S", emote: "EmoteSalute", item: null, x: null, y: null } },
    ]);
  });
});
