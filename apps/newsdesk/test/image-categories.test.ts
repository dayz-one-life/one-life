import { describe, it, expect } from "vitest";
import { MORGUE_CATEGORIES, NURSERY_CATEGORIES, eligibleCategories } from "../src/image-categories.js";

const slugs = (kind: "obituary" | "birth_notice", facts: Record<string, unknown>) =>
  eligibleCategories(kind, facts).map((c) => c.slug);

describe("menus", () => {
  it("carries 16 morgue and 13 nursery categories, unique slugs, caps captions", () => {
    expect(MORGUE_CATEGORIES).toHaveLength(16);
    expect(NURSERY_CATEGORIES).toHaveLength(13);
    const all = [...MORGUE_CATEGORIES, ...NURSERY_CATEGORIES];
    expect(new Set(all.map((c) => c.slug)).size).toBe(all.length);
    for (const c of all) expect(c.caption).toBe(c.caption.toUpperCase());
  });
});

describe("eligibleCategories — obituary gates", () => {
  const base = { causeCategory: "environment", cause: "died", weapon: null, killerGamertag: null,
    kills: 3, timeAliveSeconds: 7200, freshSpawnVictim: false, map: "chernarusplus" };

  it("ungated categories always fire", () => {
    const s = slugs("obituary", base);
    for (const slug of ["aftermath", "last-known", "witnesses", "memorial"]) expect(s).toContain(slug);
  });
  it("pvp-only categories need pvp facts", () => {
    expect(slugs("obituary", base)).not.toContain("approached-for-comment");
    expect(slugs("obituary", { ...base, causeCategory: "pvp", killerGamertag: "KosKing", weapon: "DMR" }))
      .toEqual(expect.arrayContaining(["vantage", "approached-for-comment"]));
  });
  it("first-aid excludes pvp; effects/visibility need environment or unknown", () => {
    const pvp = slugs("obituary", { ...base, causeCategory: "pvp" });
    expect(pvp).not.toContain("first-aid-attempted");
    expect(pvp).not.toContain("effects");
    expect(slugs("obituary", base)).toEqual(expect.arrayContaining(["first-aid-attempted", "effects", "visibility-factor"]));
  });
  it("trail-ends-here: unknown cause anywhere, environment only on sakhal", () => {
    expect(slugs("obituary", { ...base, causeCategory: "unknown" })).toContain("trail-ends-here");
    expect(slugs("obituary", base)).not.toContain("trail-ends-here");
    expect(slugs("obituary", { ...base, map: "sakhal" })).toContain("trail-ends-here");
  });
  it("fact-threshold gates", () => {
    expect(slugs("obituary", { ...base, freshSpawnVictim: true })).toContain("worldly-possessions");
    expect(slugs("obituary", { ...base, kills: 0, timeAliveSeconds: 90000 })).toContain("pacifists-garden");
    expect(slugs("obituary", base)).not.toContain("pacifists-garden");
    expect(slugs("obituary", { ...base, timeAliveSeconds: 700000 })).toContain("construction-halted");
  });
  it("cause-string gates stay dormant on today's coarse vocabulary", () => {
    const s = slugs("obituary", base); // cause: "died"
    for (const slug of ["driver-not-pictured", "gravity-undefeated", "suspect-at-large"]) expect(s).not.toContain(slug);
    expect(slugs("obituary", { ...base, cause: "killed by Wolf" })).toContain("suspect-at-large");
  });
  it("suspect-at-large fires on a mauled verdict even with a coarse cause token", () => {
    const cats = eligibleCategories("obituary", {
      causeCategory: "environment", cause: "died",
      verdict: { cause: "mauled", confidence: "high", conditions: ["bleeding", "hunted"] },
    });
    expect(cats.map((c) => c.slug)).toContain("suspect-at-large");
  });
  it("suspect-at-large stays dormant without a mauled verdict or matching cause substring", () => {
    const cats = eligibleCategories("obituary", { causeCategory: "environment", cause: "died", verdict: { cause: "starvation", confidence: "high", conditions: [] } });
    expect(cats.map((c) => c.slug)).not.toContain("suspect-at-large");
  });
  it("stage-2 cause tokens light the dormant gates with zero gate changes", () => {
    const slugs = (cause: string) =>
      eligibleCategories("obituary", { causeCategory: "environment", cause }).map((c) => c.slug);
    expect(slugs("wolf")).toContain("suspect-at-large");
    expect(slugs("bear")).toContain("suspect-at-large");
    expect(slugs("fall")).toContain("gravity-undefeated");
    expect(slugs("vehicle")).toContain("driver-not-pictured"); // reserved token, gate ready
  });
});

describe("eligibleCategories — birth gates", () => {
  const first = { lifeNumber: 1, minutesToQualify: 12, map: "chernarusplus", isKnownQuantity: false,
    priors: { livesLived: 0, totalKills: 0 } };
  it("first-lifers: first-contact yes, stare/returns no", () => {
    const s = slugs("birth_notice", first);
    expect(s).toContain("first-contact");
    expect(s).not.toContain("stare");
    expect(s).not.toContain("many-happy-returns");
  });
  it("veterans: stare + returns + residents-advised on a 20-kill career", () => {
    const s = slugs("birth_notice", { lifeNumber: 6, minutesToQualify: null, map: "sakhal",
      isKnownQuantity: true, priors: { livesLived: 5, totalKills: 24 } });
    expect(s).toEqual(expect.arrayContaining(["stare", "many-happy-returns", "residents-advised", "adverse-conditions"]));
    expect(s).not.toContain("first-contact");
    expect(s).not.toContain("slow-burner"); // null minutesToQualify never fires it
  });
  it("slow-burner needs >= 60 minutes", () => {
    expect(slugs("birth_notice", { ...first, minutesToQualify: 75 })).toContain("slow-burner");
  });
});
