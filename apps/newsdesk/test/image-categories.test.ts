import { describe, it, expect } from "vitest";
import { MORGUE_CATEGORIES, NURSERY_CATEGORIES, NEWSROOM_CATEGORIES, eligibleCategories } from "../src/image-categories.js";
import type { ArticleKind, NewsImageFacts } from "../src/image-categories.js";

describe("ArticleKind", () => {
  it("admits news", () => {
    const kinds: ArticleKind[] = ["obituary", "birth_notice", "news"];
    expect(kinds).toHaveLength(3);
  });
});

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
  const base = { causeCategory: "environment", cause: "bled_out", weapon: null, killerGamertag: null,
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
  it("an unrecorded cause (causeCategory 'unknown') keeps effects and gains the mystery framing", () => {
    const unknown = { ...base, causeCategory: "unknown", cause: "died" };
    const s = slugs("obituary", unknown);
    expect(s).toContain("effects");             // recovered belongings are cause-agnostic
    expect(s).toContain("trail-ends-here");     // widened: fires on every map, not just Sakhal
    expect(s).toContain("visibility-factor");
    expect(s).toContain("first-aid-attempted");
    expect(s).not.toContain("vantage");
    expect(s).not.toContain("approached-for-comment");
  });
  it("suicide gates: effects + first-aid fire; blame/mystery/conditions framings never do", () => {
    const suicide = { ...base, causeCategory: "suicide", cause: "suicide" };
    const s = slugs("obituary", suicide);
    // Fires — belongings and an attempted rescue are dignified, imply-don't-depict framings.
    expect(s).toContain("effects");
    expect(s).toContain("first-aid-attempted");
    // Never fires — these assert a shooter, a suspect, a mystery, or a blameless condition.
    expect(s).not.toContain("vantage");
    expect(s).not.toContain("approached-for-comment");
    expect(s).not.toContain("trail-ends-here");
    expect(s).not.toContain("visibility-factor");
    // A suicide on Sakhal still must not borrow the mystery framing.
    expect(slugs("obituary", { ...suicide, map: "sakhal" })).not.toContain("trail-ends-here");
    // Ungated categories are unaffected.
    for (const slug of ["aftermath", "last-known", "witnesses", "memorial"]) expect(s).toContain(slug);
  });
  it("fact-threshold gates", () => {
    expect(slugs("obituary", { ...base, freshSpawnVictim: true })).toContain("worldly-possessions");
    expect(slugs("obituary", { ...base, kills: 0, timeAliveSeconds: 90000 })).toContain("pacifists-garden");
    expect(slugs("obituary", base)).not.toContain("pacifists-garden");
    expect(slugs("obituary", { ...base, timeAliveSeconds: 700000 })).toContain("construction-halted");
  });
  it("cause-string gates stay dormant on today's coarse vocabulary", () => {
    const s = slugs("obituary", base); // cause: "bled_out" — matches no substring gate
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

describe("eligibleCategories — kind routing", () => {
  it("never hands a non-obituary kind the nursery menu by default", () => {
    const newsSlugs = eligibleCategories("news", {}).map((c) => c.slug);
    const nurserySlugs = NURSERY_CATEGORIES.map((c) => c.slug);
    expect(newsSlugs.some((s) => nurserySlugs.includes(s))).toBe(false);
  });

  it("throws on a kind with no menu rather than filtering undefined", () => {
    expect(() => eligibleCategories("bogus" as ArticleKind, {})).toThrow(/no image category menu/);
  });
});

describe("newsroom menu", () => {
  // Typed against the published contract, NOT a loose literal: if news-facts.ts renames a field,
  // NewsImageFacts changes, and this fixture stops compiling. `lastExpressiveEmote` is gone —
  // the emote slot was cut (no allowlist signal, and reading it means querying events.payload,
  // the column that also holds coordinates).
  const standing: NewsImageFacts = { trigger: "standing_dead", map: "chernarusplus", idleHours: 96,
    timeAliveSeconds: 5400, hitsAbsorbed: 12, lifeNumber: 3, priors: { livesLived: 2, totalKills: 4 },
    subjectCount: 1, allFreshSubjects: false };
  const longform: NewsImageFacts = { trigger: "long_form", map: "sakhal", idleHours: null,
    timeAliveSeconds: 0, hitsAbsorbed: 0, lifeNumber: 1, priors: { livesLived: 0, totalKills: 0 },
    subjectCount: 2, allFreshSubjects: true };
  const newsSlugs = (f: Record<string, unknown>) => eligibleCategories("news", f).map((c) => c.slug);

  it("carries 13 entries with unique kebab slugs and CAPS captions <= 48 chars", () => {
    expect(NEWSROOM_CATEGORIES).toHaveLength(13);
    const all = [...MORGUE_CATEGORIES, ...NURSERY_CATEGORIES, ...NEWSROOM_CATEGORIES];
    expect(new Set(all.map((c) => c.slug)).size).toBe(all.length);
    for (const c of NEWSROOM_CATEGORIES) {
      expect(c.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(c.caption).toBe(c.caption.toUpperCase());
      expect(c.caption.length).toBeLessThanOrEqual(48);
      expect(c.example.length).toBeGreaterThan(20);
    }
  });

  it("never returns an empty eligible set", () => {
    expect(eligibleCategories("news", {}).length).toBeGreaterThan(0);
    expect(newsSlugs(standing).length).toBeGreaterThan(0);
    expect(newsSlugs(longform).length).toBeGreaterThan(0);
  });

  it("keeps standing-dead and long-form framings apart", () => {
    expect(newsSlugs(standing)).toContain("unattended-camp");
    expect(newsSlugs(standing)).not.toContain("two-sets-of-tracks");
    expect(newsSlugs(longform)).toContain("two-sets-of-tracks");
    expect(newsSlugs(longform)).not.toContain("unattended-camp");
  });

  it("gates the veteran and endurance framings on earned facts", () => {
    expect(newsSlugs({ ...standing, priors: { livesLived: 0, totalKills: 0 } })).not.toContain("the-regular");
    expect(newsSlugs(standing)).toContain("the-regular");
    expect(newsSlugs({ ...standing, hitsAbsorbed: 3 })).not.toContain("what-it-took");
    expect(newsSlugs({ ...standing, hitsAbsorbed: 100 })).toContain("what-it-took");
  });

  it("shares no framing with the morgue or nursery menus", () => {
    const others = new Set([...MORGUE_CATEGORIES, ...NURSERY_CATEGORIES].map((c) => c.caption));
    for (const c of NEWSROOM_CATEGORIES) expect(others.has(c.caption)).toBe(false);
  });

  it("carries no emote-shaped key in the facts contract (spec §11: EmoteSuicide never reaches a payload)", () => {
    // TYPE-ANCHORED, not behavioural: these are fixtures declared in this file, so the real guard
    // is the `NewsImageFacts` annotation above (a compile-time check). The behavioural rail is
    // Task 11's keysDeep walk over a BUILT NewsFacts object — do not read this as coverage of it.
    expect(Object.keys(standing).some((k) => /emote/i.test(k))).toBe(false);
    expect(Object.keys(longform).some((k) => /emote/i.test(k))).toBe(false);
  });

  it("a null idleHours never trips the long-idle framing", () => {
    expect(newsSlugs(longform)).not.toContain("long-idle");
    expect(newsSlugs({ ...standing, idleHours: 119 })).not.toContain("long-idle");
    expect(newsSlugs({ ...standing, idleHours: 120 })).toContain("long-idle");
  });
});
