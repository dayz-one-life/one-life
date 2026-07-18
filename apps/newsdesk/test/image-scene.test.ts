import { describe, it, expect } from "vitest";
import { buildScenePrompt, parseScene } from "../src/image-scene.js";
import { MORGUE_CATEGORIES } from "../src/image-categories.js";

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
