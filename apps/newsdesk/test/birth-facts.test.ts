import { describe, it, expect } from "vitest";
import { buildBirthFacts } from "../src/birth-facts.js";
import type { BirthNoticeTarget } from "../src/birth-pg-store.js";
import type { PlayerPriors } from "@onelife/read-models";

const target: BirthNoticeTarget = {
  lifeId: 1, serverId: 1, gamertag: "Boots", map: "chernarusplus",
  mapSlug: "chernarus", lifeNumber: 3,
  lifeStartedAt: new Date("2026-07-17T02:00:00Z"), endedAt: null,
};

const priors = (over: Partial<PlayerPriors> = {}): PlayerPriors => ({
  livesLived: 0, longestLifeSeconds: 0, totalKills: 0,
  usualDeathCause: null, lastDeathCause: null, bestLifeMap: null, ...over,
});

function timeline(over: Partial<{ character: unknown; qualifiedAt: unknown }> = {}) {
  return {
    life: { startedAt: new Date("2026-07-17T02:00:00Z"), endedAt: null, playtimeSeconds: 420, deathCause: null },
    sessions: [{}],
    kills: [],
    character: "character" in over ? over.character : { name: "Lewis" },
    qualifiedAt: "qualifiedAt" in over ? over.qualifiedAt : { at: new Date("2026-07-17T02:07:00Z"), by: "playtime" },
  } as unknown as import("@onelife/read-models").LifeTimeline;
}

describe("buildBirthFacts", () => {
  it("derives bornAt, minutesToQualify, persona, and known-quantity flag from a known player", () => {
    const f = buildBirthFacts(target, timeline(), priors({ livesLived: 4, totalKills: 12 }));
    expect(f.bornAt.toISOString()).toBe("2026-07-17T02:00:00.000Z");
    expect(f.minutesToQualify).toBe(7); // 02:07:00 − 02:00:00 = 7 whole minutes
    expect(f.persona).toBe("Lewis");
    expect(f.isKnownQuantity).toBe(true);
    expect(f.priors.livesLived).toBe(4);
    expect(f.gamertag).toBe("Boots");
    expect(f.map).toBe("chernarusplus");
    expect(f.mapSlug).toBe("chernarus");
    expect(f.lifeNumber).toBe(3);
    expect(f.endedAt).toBeNull();
  });

  it("floors minutesToQualify to whole minutes", () => {
    const f = buildBirthFacts(
      target,
      timeline({ qualifiedAt: { at: new Date("2026-07-17T02:12:45Z"), by: "kill" } }),
      priors(),
    );
    expect(f.minutesToQualify).toBe(12); // 12m45s -> 12
  });

  it("first-lifer with zero prior lives is NOT a known quantity", () => {
    const f = buildBirthFacts(target, timeline(), priors());
    expect(f.isKnownQuantity).toBe(false);
  });

  it("null minutesToQualify when the life has not qualified yet", () => {
    const f = buildBirthFacts(target, timeline({ qualifiedAt: null }), priors());
    expect(f.minutesToQualify).toBeNull();
  });

  it("null persona when no character resolved", () => {
    const f = buildBirthFacts(target, timeline({ character: null }), priors());
    expect(f.persona).toBeNull();
  });

  it("carries endedAt when the life already died before the sweep", () => {
    const died: BirthNoticeTarget = { ...target, endedAt: new Date("2026-07-17T05:00:00Z") };
    const f = buildBirthFacts(died, timeline(), priors());
    expect(f.endedAt?.toISOString()).toBe("2026-07-17T05:00:00.000Z");
  });
});
