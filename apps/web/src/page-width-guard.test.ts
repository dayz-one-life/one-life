import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Page-width tripwire. The site shell is a COLUMN FLEXBOX, and a flex item with
 * `margin-inline: auto` stops stretching and shrink-wraps to its content's intrinsic width —
 * so a page wrapper written `mx-auto max-w-[68ch]` renders at whatever width its widest child
 * happens to be (The Roster shipped at 276px of its intended 605px). Every centered wrapper
 * therefore needs `w-full` alongside `mx-auto` + `max-w-*`; this scan makes forgetting it a
 * red test instead of a page that quietly renders at a random width.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

describe("page width", () => {
  const roots = [join(__dirname, "app"), join(__dirname, "components")];
  const offenders: string[] = [];
  for (const root of roots) {
    for (const file of walk(root)) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/className="([^"]*)"/g)) {
        const cls = m[1] ?? "";
        if (cls.includes("mx-auto") && /(^|\s)max-w-/.test(cls) && !cls.includes("w-full")) {
          offenders.push(`${relative(__dirname, file)}: "${cls}"`);
        }
      }
    }
  }

  test("every mx-auto max-w-* wrapper also carries w-full", () => {
    expect(offenders).toEqual([]);
  });
});
