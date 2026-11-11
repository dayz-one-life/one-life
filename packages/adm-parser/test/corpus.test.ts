import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { parseLine } from "../src/index.js";
import type { ParsedLine } from "../src/index.js";

/**
 * The parser corpus gate — a MANUAL release gate over PRIVATE data.
 *
 * It replays `parseLine` over every raw line of a private corpus and compares the result with a
 * baseline built from the v0.80.0 tag. The corpus and the baseline hold real player data and are
 * never in this repository; they live wherever `DEATH_GOLDEN_DIR` points:
 *
 *   $DEATH_GOLDEN_DIR/corpus/ol_raw_lines.tsv          server, file, line, time, text
 *   $DEATH_GOLDEN_DIR/parser/corpus-baseline.json.gz   { meta, results[] } from the tag
 *   $DEATH_GOLDEN_DIR/parser/stored-causes.json        "<file>:<line>" -> { life, cause }
 *
 * Unset (CI, a fresh clone), the suite is skipped with a notice — the public shape tests in
 * death.test.ts are what guard the parser there.
 *
 * ⚠️ Nothing here may print a raw line, a callsign, an id or a coordinate. Failure messages carry
 * a shape name and a count, nothing else — the output of this suite is pasted into pull requests.
 */
const GOLD = process.env.DEATH_GOLDEN_DIR;
const paths = GOLD
  ? {
      corpus: join(GOLD, "corpus", "ol_raw_lines.tsv"),
      baseline: join(GOLD, "parser", "corpus-baseline.json.gz"),
      stored: join(GOLD, "parser", "stored-causes.json"),
    }
  : null;
const ready = paths != null && Object.values(paths).every((p) => existsSync(p));

if (!ready) {
  console.warn(
    GOLD
      ? "[corpus.test] SKIPPED — DEATH_GOLDEN_DIR is set but the corpus, baseline or stored-causes file is missing."
      : "[corpus.test] SKIPPED — DEATH_GOLDEN_DIR is unset. The parser corpus gate runs only where the private golden data is.",
  );
}

type Death = Extract<ParsedLine, { kind: "death" }>;
type Shape =
  | "explosive entity" | "empty-killer 40mm" | "empty-killer other" | "no-driver vehicle"
  | "motorbike entity" | "self-kill" | "dead killer, other player" | "other";

/** The fields a death result is allowed to differ in. Everything else must be byte-identical. */
const MAY_DIFFER = new Set(["cause", "killer", "weapon", "deathEntity"]);
const EXPLOSIVE = /killed by (M67Grenade|RGD5Grenade|6-M7 Frag Grenade|EGD-5 Frag Grenade|LandMineTrap|Claymore(Mine)?|Plastic[ _]Explosive|Land_FuelStation_Feed\S*)\s*$/u;
const KILLER = /\(id=([^\s)]+)[^)]*\) killed by Player "[^"]+" (\(DEAD\) )?\(id=([^\s)]+)/u;

/** Which of the shapes this release means to change a raw line belongs to. Independent of the
 *  parser under test on purpose — it reads the text, not the parse. */
function shapeOf(text: string): Shape {
  const k = KILLER.exec(text);
  if (k) return k[1] === k[3] ? "self-kill" : k[2] ? "dead killer, other player" : "other";
  if (/killed by NO DRIVER \(/u.test(text)) return "no-driver vehicle";
  if (/killed by  with 40mm/u.test(text)) return "empty-killer 40mm";
  if (/killed by  with /u.test(text)) return "empty-killer other";
  if (EXPLOSIVE.test(text)) return "explosive entity";
  if (/killed by Motorbike_/u.test(text)) return "motorbike entity";
  return "other";
}

/** What each intended shape must now parse to. */
const EXPECT: Record<Exclude<Shape, "other">, (d: Death) => boolean> = {
  "explosive entity": (d) => d.cause === "explosion" && d.killer === null && d.weapon === null && d.deathEntity !== null,
  "empty-killer 40mm": (d) => d.cause === "explosion" && d.killer === null && d.weapon === null && /^40mm/.test(d.deathEntity ?? ""),
  "empty-killer other": (d) => d.cause === "environment" && d.killer === null && d.weapon === null && d.deathEntity !== null,
  "no-driver vehicle": (d) => d.cause === "vehicle" && d.killer === null && d.weapon === null && d.deathEntity !== null,
  "motorbike entity": (d) => d.cause === "vehicle" && d.killer === null,
  "self-kill": (d) => (d.cause === "explosion" || d.cause === "environment") && d.killer === null && d.deathEntity === d.weapon,
  "dead killer, other player": (d) => d.cause === "pvp" && d.killer !== null && d.deathEntity === null,
};

const bump = (m: Map<string, number>, key: string) => m.set(key, (m.get(key) ?? 0) + 1);
const table = (m: Map<string, number>) => Object.fromEntries([...m].sort(([a], [b]) => a.localeCompare(b)));

describe.skipIf(!ready)("parser corpus vs v0.80.0 (private data, manual gate)", () => {
  // Everything is computed once; the `it`s below only assert over the tallies.
  const run = (() => {
    if (!ready || !paths) return null;
    const rows = readFileSync(paths.corpus, "utf8").split("\n");
    if (rows[rows.length - 1] === "") rows.pop();
    const baseline = JSON.parse(gunzipSync(readFileSync(paths.baseline)).toString("utf8")) as {
      meta: { tag: string | null; commit: string; lines: number }; results: string[];
    };
    const stored = (JSON.parse(readFileSync(paths.stored, "utf8")) as {
      lines: Record<string, { life: number; cause: string }>;
    }).lines;

    const t = {
      lines: rows.length, baselineLines: baseline.results.length, tag: baseline.meta.tag,
      deathLines: 0, changedDeathLines: 0,
      nonDeathDiffs: 0, countDiffs: 0, kindOrderDiffs: 0,
      forbiddenFieldDiffs: new Map<string, number>(),   // field name -> lines
      unintendedShape: 0,                               // a changed line that is no listed shape
      wrongResult: new Map<string, number>(),           // listed shape, but not the expected parse
      fragmentEntities: new Map<string, number>(),      // deathEntity that is a clause fragment
      changes: new Map<string, number>(),               // "shape: old -> new [fields]" -> lines
      shapeLines: new Map<string, number>(),            // every line of a listed shape, changed or not
      causeChangedLives: new Map<string, Set<number>>(),// new cause -> lives
      sameCauseLives: new Map<string, Set<number>>(),   // "shape (cause)" -> lives, cause unchanged
      backfillWouldPatch: 0,                            // a changed cause that is NOT what is stored
      changedCauseNoStoredRow: 0,
    };

    rows.forEach((row, i) => {
      const p = row.split("\t");
      const text = p.slice(4).join("\t");
      const key = `${p[1]}:${p[2]}`;
      const now = parseLine(text);
      const then = JSON.parse(baseline.results[i] ?? "[]") as ParsedLine[];

      if (now.length !== then.length) { t.countDiffs++; return; }
      if (now.some((r, j) => r.kind !== then[j]!.kind)) { t.kindOrderDiffs++; return; }
      const shape = shapeOf(text);
      now.forEach((r, j) => {
        const before = then[j]!;
        if (r.kind !== "death") {
          if (JSON.stringify(r) !== JSON.stringify(before)) t.nonDeathDiffs++;
          return;
        }
        t.deathLines++;
        if (shape !== "other") bump(t.shapeLines, shape);
        if (["6", "EGD", "NO", "Player"].includes(r.deathEntity ?? "")) bump(t.fragmentEntities, r.deathEntity!);
        const was = before as Death;
        const fields = (Object.keys({ ...was, ...r }) as (keyof Death)[]).filter((f) => r[f] !== was[f]);
        const life = stored[key]?.life;
        if (fields.length === 0) return;

        t.changedDeathLines++;
        for (const f of fields) if (!MAY_DIFFER.has(f)) bump(t.forbiddenFieldDiffs, f);
        if (shape === "other") { t.unintendedShape++; return; }
        if (!EXPECT[shape](r)) bump(t.wrongResult, shape);
        bump(t.changes, `${shape}: ${was.cause} -> ${r.cause} [${fields.sort().join(",")}]`);

        if (r.cause !== was.cause) {
          if (life == null) t.changedCauseNoStoredRow++;
          else {
            if (!t.causeChangedLives.has(r.cause)) t.causeChangedLives.set(r.cause, new Set());
            t.causeChangedLives.get(r.cause)!.add(life);
            // backfill-death-causes upgrades a stored cause only when the parser now says something
            // else. If production already stores the new word, a run changes nothing.
            if (stored[key]!.cause !== r.cause) t.backfillWouldPatch++;
          }
        } else if (life != null) {
          const k = `${shape} (${r.cause})`;
          if (!t.sameCauseLives.has(k)) t.sameCauseLives.set(k, new Set());
          t.sameCauseLives.get(k)!.add(life);
        }
      });
    });
    return t;
  })()!;

  const lives = (m: Map<string, Set<number>>) => Object.fromEntries([...m].map(([k, v]) => [k, v.size]));

  it("prints what changed, as counts by shape only", () => {
    console.info("[corpus.test] " + JSON.stringify({
      baseline: run.tag, lines: run.lines, deathLines: run.deathLines, changedDeathLines: run.changedDeathLines,
      changedByShape: table(run.changes), linesOfEachListedShape: table(run.shapeLines),
      livesWithANewCause: lives(run.causeChangedLives), livesWithTheSameCause: lives(run.sameCauseLives),
    }, null, 2));
    expect(run.lines).toBe(run.baselineLines);
  });

  it("every non-death kind is identical to v0.80.0", () => {
    expect(run.nonDeathDiffs).toBe(0);
  });

  it("no line changes its number of parsed results", () => {
    expect(run.countDiffs).toBe(0);
    expect(run.kindOrderDiffs).toBe(0);
  });

  it("death results differ only in cause, killer, weapon and deathEntity, and only on the listed shapes", () => {
    // `distance` rides with `weapon` on a self-kill line (the line states both); it is reported
    // separately so the exception is visible rather than folded into the allowed set.
    const forbidden = new Map(run.forbiddenFieldDiffs);
    const selfKillDistance = [...run.changes].filter(([k]) => k.startsWith("self-kill") && k.includes("distance"))
      .reduce((n, [, v]) => n + v, 0);
    if ((forbidden.get("distance") ?? 0) === selfKillDistance) forbidden.delete("distance");
    expect(table(forbidden)).toEqual({});
    expect(run.unintendedShape).toBe(0);
    expect(table(run.wrongResult)).toEqual({});
    // Every line of a listed shape changed — none was left behind on the old parse.
    const changedPerShape = new Map<string, number>();
    for (const [k, v] of run.changes) {
      const s = k.slice(0, k.indexOf(":"));
      changedPerShape.set(s, (changedPerShape.get(s) ?? 0) + v);
    }
    expect(table(changedPerShape)).toEqual(table(run.shapeLines));
    // The lives this release was written for.
    expect(lives(run.causeChangedLives)).toEqual({ explosion: 13, vehicle: 4 });
    expect(run.sameCauseLives.get("empty-killer other (environment)")?.size).toBe(2);
  });

  it('no deathEntity is "6", "EGD", "NO" or "Player"', () => {
    expect(table(run.fragmentEntities)).toEqual({});
  });

  it("backfill-death-causes would change nothing", () => {
    expect(run.changedCauseNoStoredRow).toBe(0);
    expect(run.backfillWouldPatch).toBe(0);
  });
});
