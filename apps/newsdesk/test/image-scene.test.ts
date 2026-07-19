import { describe, it, expect } from "vitest";
import { buildScenePrompt, parseScene, IMAGE_SCENE_SYSTEM } from "../src/image-scene.js";
import { MORGUE_CATEGORIES } from "../src/image-categories.js";
import type { ArticleKind } from "../src/image-categories.js";

const eligible = MORGUE_CATEGORIES.slice(0, 3);
const base = {
  kind: "obituary" as const,
  facts: { gamertag: "Boots", map: "chernarusplus", cause: "pvp" },
  headline: "Six Meters Was All It Took",
  lede: "He never heard it.",
  eligible,
  recent: [{ caption: "LAST KNOWN PHOTO", sceneLine: "A survivor on a muddy road." }],
};

describe("buildScenePrompt", () => {
  it("system carries the hard rails and the JSON contract", () => {
    const { system } = buildScenePrompt(base);
    for (const marker of ["never a corpse", "Fog Rule", "no legible text", "escape hatch", '"caption"', '"scene"']) {
      expect(system.toLowerCase()).toContain(marker.toLowerCase());
    }
  });
  it("user carries facts, headline, eligible categories only, and the do-not-repeat block", () => {
    const { user } = buildScenePrompt(base);
    expect(user).toContain("Six Meters Was All It Took");
    for (const c of eligible) expect(user).toContain(c.caption);
    expect(user).not.toContain("CONSTRUCTION HALTED"); // not in the eligible slice
    expect(user).toContain("LAST KNOWN PHOTO — A survivor on a muddy road.");
  });
  it("omits the recent block when there are no recent covers", () => {
    const { user } = buildScenePrompt({ ...base, recent: [] });
    expect(user).not.toContain("do NOT repeat");
  });
});

describe("parseScene", () => {
  it("parses, trims, and uppercases the caption", () => {
    const out = parseScene(JSON.stringify({ caption: " Last Known Photo ", scene: "A lone rifle in the grass beside a cold fire." }));
    expect(out.caption).toBe("LAST KNOWN PHOTO");
    expect(out.scene).toMatch(/^A lone rifle/);
  });
  it("collapses internal newlines in the scene to one paragraph", () => {
    const out = parseScene(JSON.stringify({ caption: "DAY ONE", scene: "A fire.\nIn the rain, struggling badly against the wet wood." }));
    expect(out.scene).not.toContain("\n");
  });
  it("salvages JSON wrapped in prose fences", () => {
    const out = parseScene('Sure! ```json\n{"caption":"DAY ONE","scene":"A struggling campfire in the drizzle at dusk."}\n```');
    expect(out.caption).toBe("DAY ONE");
  });
  it("rejects captions over 48 chars and scenes under 20", () => {
    expect(() => parseScene(JSON.stringify({ caption: "X".repeat(49), scene: "A perfectly valid scene line for the test." }))).toThrow();
    expect(() => parseScene(JSON.stringify({ caption: "OK", scene: "too short" }))).toThrow();
  });
});

const args = (over: Partial<Parameters<typeof buildScenePrompt>[0]> = {}) => ({
  kind: "news" as ArticleKind, facts: {}, headline: "H", lede: null,
  eligible: [], recent: [], ...over,
});

describe("buildScenePrompt — kind label", () => {
  it("labels news as a news feature, not a birth notice", () => {
    const { user } = buildScenePrompt(args());
    expect(user).toContain("Article kind: news feature (The Newsroom)");
    expect(user).not.toContain("The Nursery");
  });

  it("throws on an unknown kind", () => {
    expect(() => buildScenePrompt(args({ kind: "bogus" as ArticleKind })))
      .toThrow(/unknown article kind for scene prompt/);
  });

  it("flags a low-confidence verdict explicitly instead of burying it in the facts JSON", () => {
    const { user } = buildScenePrompt(args({ facts: { verdict: { cause: "bled_out", confidence: "low" } } }));
    expect(user).toContain("The stated cause is LOW CONFIDENCE");
    expect(buildScenePrompt(args({ facts: { verdict: { cause: "pvp", confidence: "high" } } })).user)
      .not.toContain("LOW CONFIDENCE");
  });
});

describe("IMAGE_SCENE_SYSTEM", () => {
  it("carries a news tone arm and the alive-subject rail", () => {
    expect(IMAGE_SCENE_SYSTEM).toContain("news features =");
    expect(IMAGE_SCENE_SYSTEM).toContain("A news subject may still be ALIVE");
    expect(IMAGE_SCENE_SYSTEM).toContain("low confidence");
  });
});
