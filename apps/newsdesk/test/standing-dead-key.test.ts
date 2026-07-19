import { describe, it, expect } from "vitest";
import { standingDeadNaturalKey } from "../src/standing-dead-targets.js";

describe("standingDeadNaturalKey", () => {
  it("emits the exact spec §4.1.3 format", () => {
    expect(standingDeadNaturalKey(7, "GabeFox101", new Date("2026-07-11T12:00:00.000Z")))
      .toBe("standing_dead:7:GabeFox101:2026-07-11T12:00:00.000Z");
  });

  it("preserves gamertag casing verbatim and never lowercases", () => {
    expect(standingDeadNaturalKey(1, "Cee Lo GREEN 96", new Date("2026-01-02T03:04:05.678Z")))
      .toBe("standing_dead:1:Cee Lo GREEN 96:2026-01-02T03:04:05.678Z");
  });

  it("contains no numeric row id — the key must survive a projection rebuild", () => {
    const k = standingDeadNaturalKey(7, "Ay", new Date("2026-07-11T12:00:00.000Z"));
    expect(k.split(":")[1]).toBe("7"); // server id only; lives.id appears nowhere
    expect(k).not.toMatch(/lifeId|life_id/);
  });
});
