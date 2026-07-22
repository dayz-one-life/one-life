import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/** Type-floor tripwire (spec §3): these files carry CONTENT, not chrome — nothing in them
 *  may use a 9px/10px text utility. Decorative overlines elsewhere are exempt on purpose. */
const CONTENT_FILES = [
  "components/obituaries/rap-sheet.tsx",
  "components/birth-notices/priors-box.tsx",
  "components/player/stat.tsx",
  "components/life/hero.tsx",
  "components/notifications/row.tsx",
  "components/notifications/push-toggle.tsx",
  "components/friends/presence-toggles.tsx",
];

describe("type floor", () => {
  test.each(CONTENT_FILES)("%s has no sub-11px text utility", (file) => {
    const src = readFileSync(join(__dirname, file), "utf8");
    expect(src).not.toMatch(/text-\[(\d|10)(\.\d+)?px\]/);
  });
});
