import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  goldenInputsReady, goldenPaths, loadGoldenDeaths, publicOf, snapshotEntry, type LabelSnapshotEntry,
} from "./from-classified.js";
import { writerBrief } from "../../src/index.js";

/**
 * The label gate — a MANUAL gate over PRIVATE data.
 *
 * For every One Life death in the golden set it computes what the site will print and compares it
 * with `labels.snapshot.json`, a file a person has read line by line. A wording change that moves
 * any real death shows up here as a count, and the snapshot has to be regenerated and read again.
 *
 *   $DEATH_GOLDEN_DIR/labels.snapshot.json   uid -> { label, detail, sentence, caption, tag, certainty }
 *   $DEATH_GOLDEN_DIR/labels.expected.json   the counts the design was reviewed against
 *
 * ⚠️ The counts live in the private file, not here. They are figures about real players' deaths;
 * this repository is public, so the test names what is counted and never how many.
 *
 * Unset (CI, a fresh clone), the suite is skipped with a notice; the public tests in
 * present.test.ts and vocabulary.test.ts are what guard the wording there.
 *
 * ⚠️ Nothing here may print a uid, a callsign or a sentence that holds one. Failures are counts.
 */
const GOLD = process.env.DEATH_GOLDEN_DIR;
const ready = goldenInputsReady(GOLD) && existsSync(goldenPaths(GOLD).snapshot) && existsSync(goldenPaths(GOLD).expected);

if (!ready) {
  console.warn(
    GOLD
      ? "[golden-labels.test] SKIPPED — DEATH_GOLDEN_DIR is set but the golden answers, the corpus tables, labels.snapshot.json or labels.expected.json are missing."
      : "[golden-labels.test] SKIPPED — DEATH_GOLDEN_DIR is unset. The label gate runs only where the private golden data is.",
  );
}

interface Expected {
  rows: number;
  storedConfidence: Record<string, number>;
  afterKnockOut: { deaths: number; labels: Record<string, number> };
  likelyLabels: number; notRecorded: number;
  namedKillers: number; namedDrivers: number; trapDeaths: number; trapCredits: number;
}
const tally = <T,>(xs: T[], key: (x: T) => string) => {
  const m: Record<string, number> = {};
  for (const x of xs) m[key(x)] = (m[key(x)] ?? 0) + 1;
  return m;
};

// `pnpm run golden` sets this: there, a missing input is a failure, not a skip.
if (!ready && process.env.DEATH_GOLDEN_REQUIRED) {
  throw new Error("[golden-labels.test] DEATH_GOLDEN_REQUIRED is set but the private golden data is not available.");
}

describe.skipIf(!ready)("labels of the golden deaths (private data, manual gate)", () => {
  const run = (() => {
    if (!ready || !GOLD) return null;
    const deaths = loadGoldenDeaths(GOLD);
    const snapshot = (JSON.parse(readFileSync(goldenPaths(GOLD).snapshot, "utf8")) as {
      labels: Record<string, LabelSnapshotEntry>;
    }).labels;
    const publics = deaths.map((d) => ({ d, p: publicOf(d) }));
    const FIELDS = ["label", "detail", "sentence", "caption", "tag", "certainty"] as const;
    const differing: Record<string, number> = {};
    let missing = 0;
    for (const { d, p } of publics) {
      const want = snapshot[d.uid];
      if (!want) { missing++; continue; }
      const got = snapshotEntry(p);
      for (const f of FIELDS) if (got[f] !== want[f]) differing[f] = (differing[f] ?? 0) + 1;
    }
    const want = JSON.parse(readFileSync(goldenPaths(GOLD).expected, "utf8")) as Expected;
    return { deaths, publics, snapshotSize: Object.keys(snapshot).length, missing, differing, want };
  })();

  it("every golden death produces the reviewed label snapshot", () => {
    expect(run!.want.rows).toBeGreaterThan(0);
    expect(run!.deaths.length).toBe(run!.want.rows);
    expect(run!.snapshotSize).toBe(run!.want.rows);
    expect(run!.missing).toBe(0);
    expect(run!.differing).toEqual({});
  });

  it("the certainties and the logout family come out as the design counted them", () => {
    const internal = tally(run!.deaths, (d) => d.verdict.confidence);
    expect(internal).toEqual(run!.want.storedConfidence);
    const logout = run!.publics.filter(({ d }) =>
      ["respawn_while_unconscious", "unconscious_logout", "logout_under_attack", "restrained_logout"].includes(d.verdict.cause));
    expect(logout.length).toBe(run!.want.afterKnockOut.deaths);
    expect(tally(logout, ({ p }) => p.label)).toEqual(run!.want.afterKnockOut.labels);
    // A logout death is never shown as more than strong, whatever the classifier stored.
    expect(logout.every(({ p }) => p.certainty !== "definitive")).toBe(true);
    expect(run!.publics.filter(({ p }) => p.label.startsWith("Likely ")).length).toBe(run!.want.likelyLabels);
    expect(run!.publics.filter(({ p }) => p.key === "unknown").length).toBe(run!.want.notRecorded);
  });

  it("names: a killer only from a kill line, a trap-setter only as a credit", () => {
    const named = run!.publics.filter(({ p }) => p.killerGamertag != null);
    expect(named.length).toBe(run!.want.namedKillers);
    expect(named.every(({ d, p }) => d.verdict.attrBasis === "kill_line" && d.life.deathCause === "pvp" && p.key === "pvp")).toBe(true);
    expect(run!.publics.filter(({ p }) => p.driverGamertag != null).length).toBe(run!.want.namedDrivers);
    const traps = run!.publics.filter(({ p }) => p.trap);
    expect(traps.length).toBe(run!.want.trapDeaths);
    expect(traps.filter(({ p }) => p.credit != null).length).toBe(run!.want.trapCredits);
    expect(run!.publics.filter(({ p }) => p.credit != null && !p.trap).length).toBe(0);
    // No name anywhere on a death that has neither a kill-line killer nor a credit.
    const names = new Set(run!.deaths.flatMap((d) => [d.life.deathByGamertag, d.credit?.gamertag]).filter((n): n is string => !!n && n.length >= 4));
    let leaks = 0;
    for (const { p } of run!.publics) {
      if (p.killerGamertag || p.credit) continue;
      const text = JSON.stringify(p);
      for (const n of names) if (text.includes(n)) leaks++;
    }
    expect(leaks).toBe(0);
  });

  it("every death gives the writer a line or a reason for none", () => {
    let wrong = 0;
    for (const { d, p } of run!.publics) {
      const brief = writerBrief(d.verdict, d.life, d.credit);
      const line = brief.line;
      const none = p.key === "withheld" || p.key === "unknown";
      if ((line == null) !== none) wrong++;
      if (p.certainty === "inferred" && !(line ?? "").startsWith("most likely ")) wrong++;
      if (p.certainty !== "inferred" && /likely/i.test(line ?? "")) wrong++;
      if (p.key === "withheld" && brief.directives.length !== 1) wrong++;
      if ((brief.creditLine != null) !== (p.credit != null)) wrong++;
    }
    expect(wrong).toBe(0);
  });
});
