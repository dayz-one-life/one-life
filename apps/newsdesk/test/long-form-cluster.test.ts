import { describe, it, expect } from "vitest";
import { buildLongFormClusters, longFormNaturalKey, applyLongFormExclusions, type DeathCandidate } from "../src/long-form-cluster.js";

/** Key names that would carry a raw map coordinate if one leaked through. Ported from
 *  news-facts.test.ts — test-local by convention; the newsdesk suite has no shared helper module. */
const COORDINATE_KEYS = new Set(["x", "y", "posX", "posY", "coordX", "coordY", "lat", "lon"]);

/**
 * Recursively collects every object key at any depth, including inside arrays. Value-independent
 * by design: it proves the Fog Rule by SHAPE, not by pattern-matching a coordinate-looking number,
 * which is exactly what `/\d{4}\.\d/` fails to do near a map's low edge (e.g. "812.4").
 */
function collectKeys(value: unknown, keys: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
  } else if (value !== null && typeof value === "object") {
    for (const [key, val] of Object.entries(value)) {
      keys.add(key);
      collectKeys(val, keys);
    }
  }
  return keys;
}

function assertNoCoordinateKeys(value: unknown): void {
  const keys = collectKeys(value);
  for (const forbidden of COORDINATE_KEYS) {
    expect(keys.has(forbidden)).toBe(false);
  }
}

const T0 = new Date("2026-07-11T12:00:00.000Z");
const at = (s: number) => new Date(T0.getTime() + s * 1000);
let seq = 0;
const cand = (o: Partial<DeathCandidate> & { gamertag: string; endedAt: Date; x: number; y: number }): DeathCandidate => ({
  lifeId: ++seq, serverId: 1, map: "chernarusplus", mapSlug: "chernarus",
  lifeNumber: 1, lifeStartedAt: T0, deathCause: "pvp", fixAt: o.endedAt, ...o,
});

const OPTS = { windowSeconds: 180, radiusMeters: 100 };

describe("buildLongFormClusters", () => {
  it("pairs two deaths inside both thresholds", () => {
    const rows = [
      cand({ gamertag: "Bee", endedAt: at(0), x: 7423.51, y: 9210.88 }),
      cand({ gamertag: "Ay", endedAt: at(27), x: 7443.51, y: 9245.88 }),
    ];
    const [c] = buildLongFormClusters(rows, OPTS);
    expect(c!.subjects.map((s) => s.gamertag)).toEqual(["Ay", "Bee"]); // gamertag asc
    expect(c!.primary.gamertag).toBe("Bee");                          // earliest endedAt
    expect(c!.earliestDeathAt.toISOString()).toBe(at(0).toISOString());
  });

  it("drops singletons", () => {
    const rows = [cand({ gamertag: "Solo", endedAt: at(0), x: 0, y: 0 })];
    expect(buildLongFormClusters(rows, OPTS)).toEqual([]);
  });

  it("rejects transitive chaining: A~B, B~C, but NOT A~C yields {A,B} only", () => {
    // spacing 100s apart each: A@0, B@100, C@200. A-C is 200s > 180s window.
    const rows = [
      cand({ gamertag: "A", endedAt: at(0), x: 0, y: 0 }),
      cand({ gamertag: "B", endedAt: at(100), x: 0, y: 0 }),
      cand({ gamertag: "C", endedAt: at(200), x: 0, y: 0 }),
    ];
    const out = buildLongFormClusters(rows, OPTS);
    expect(out).toHaveLength(1);
    expect(out[0]!.subjects.map((s) => s.gamertag)).toEqual(["A", "B"]);
  });

  it("admits a true 3-clique where every pair is inside both thresholds", () => {
    const rows = [
      cand({ gamertag: "A", endedAt: at(0), x: 0, y: 0 }),
      cand({ gamertag: "B", endedAt: at(50), x: 10, y: 10 }),
      cand({ gamertag: "C", endedAt: at(100), x: 20, y: 20 }),
    ];
    const out = buildLongFormClusters(rows, OPTS);
    expect(out).toHaveLength(1);
    expect(out[0]!.subjects.map((s) => s.gamertag)).toEqual(["A", "B", "C"]);
  });

  it("window boundary is inclusive at exactly 180s and exclusive past it", () => {
    const inRows = [
      cand({ gamertag: "A", endedAt: at(0), x: 0, y: 0 }),
      cand({ gamertag: "B", endedAt: at(180), x: 0, y: 0 }),
    ];
    expect(buildLongFormClusters(inRows, OPTS)).toHaveLength(1);
    const outRows = [
      cand({ gamertag: "A", endedAt: new Date(T0.getTime()), x: 0, y: 0 }),
      cand({ gamertag: "B", endedAt: new Date(T0.getTime() + 180_001), x: 0, y: 0 }),
    ];
    expect(buildLongFormClusters(outRows, OPTS)).toEqual([]);
  });

  it("radius boundary is inclusive at exactly 100m and exclusive past it", () => {
    const inRows = [
      cand({ gamertag: "A", endedAt: at(0), x: 0, y: 0 }),
      cand({ gamertag: "B", endedAt: at(1), x: 100, y: 0 }),
    ];
    expect(buildLongFormClusters(inRows, OPTS)).toHaveLength(1);
    const outRows = [
      cand({ gamertag: "A", endedAt: at(0), x: 0, y: 0 }),
      cand({ gamertag: "B", endedAt: at(1), x: 100.001, y: 0 }),
    ];
    expect(buildLongFormClusters(outRows, OPTS)).toEqual([]);
  });

  it("never spans servers", () => {
    const rows = [
      cand({ gamertag: "A", endedAt: at(0), x: 0, y: 0, serverId: 1 }),
      cand({ gamertag: "B", endedAt: at(5), x: 0, y: 0, serverId: 2 }),
    ];
    expect(buildLongFormClusters(rows, OPTS)).toEqual([]);
  });

  it("claims each death at most once", () => {
    const rows = [
      cand({ gamertag: "A", endedAt: at(0), x: 0, y: 0 }),
      cand({ gamertag: "B", endedAt: at(10), x: 0, y: 0 }),
      cand({ gamertag: "C", endedAt: at(20), x: 0, y: 0 }),
      cand({ gamertag: "D", endedAt: at(30), x: 0, y: 0 }),
    ];
    const out = buildLongFormClusters(rows, OPTS);
    const ids = out.flatMap((c) => c.subjects.map((s) => s.lifeId));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is deterministic under input reordering", () => {
    const rows = [
      cand({ gamertag: "A", endedAt: at(0), x: 0, y: 0 }),
      cand({ gamertag: "B", endedAt: at(50), x: 0, y: 0 }),
      cand({ gamertag: "C", endedAt: at(100), x: 0, y: 0 }),
    ];
    const a = buildLongFormClusters(rows, OPTS);
    const b = buildLongFormClusters([...rows].reverse(), OPTS);
    expect(b.map((c) => c.naturalKey)).toEqual(a.map((c) => c.naturalKey));
  });

  it("emits the exact natural key format", () => {
    expect(longFormNaturalKey(7, new Date("2026-07-11T12:00:00.000Z"), ["Zed", "Ay"]))
      .toBe("long_form:7:2026-07-11T12:00:00.000Z:Ay+Zed");
  });

  it("carries no coordinate key and no coordinate-shaped number in the returned clusters", () => {
    const rows = [
      // A cluster near a map's LOW edge: 812.40/832.08/910.88/945.02 have only 3 digits before
      // the decimal point, so none match /\d{4}\.\d/ — a real leak here would sail past the old
      // regex-only rail, which is exactly why the key walk below is the primary rail. (Same
      // ~39m offset as this file's original high-value fixture, shifted down so the pair still
      // clusters — a naive high/low pairing here would be >6600m apart and never cluster at
      // all, making the assertion below vacuously pass against an empty array.)
      cand({ gamertag: "A", endedAt: at(0), x: 812.4, y: 910.88 }),
      cand({ gamertag: "B", endedAt: at(20), x: 832.08, y: 945.02 }),
    ];
    const out = buildLongFormClusters(rows, OPTS);
    expect(out).toHaveLength(1); // sanity: the pair must actually cluster, or the walk below has nothing to inspect
    assertNoCoordinateKeys(out);
    // Cheap secondary signal only. It is NOT sufficient on its own (see the fixture comment).
    expect(JSON.stringify(out)).not.toMatch(/\d{4}\.\d/);
  });

  it("no observed gamertag contains the key separator '+'", () => {
    // Guards the un-escaped key format; see the comment in longFormNaturalKey.
    const observed = ["GabeFox101", "CUPID18", "YrJustBad", "Cee Lo GREEN 96"];
    for (const g of observed) expect(g).not.toContain("+");
  });
});

const pair = (a: string, b: string, ca: string, cb: string) =>
  buildLongFormClusters(
    [cand({ gamertag: a, endedAt: at(0), x: 0, y: 0, deathCause: ca }),
     cand({ gamertag: b, endedAt: at(27), x: 40, y: 0, deathCause: cb })],
    OPTS)[0]!;

describe("applyLongFormExclusions", () => {
  it("drops a self-cluster (same gamertag twice)", () => {
    const r = applyLongFormExclusions([pair("YrJustBad", "YrJustBad", "pvp", "pvp")], { suppressedGamertags: [] });
    expect(r.clusters).toEqual([]);
    expect(r.skipped.self_cluster).toBe(1);
  });

  it("drops a cluster CONTAINING a suicide, not only an all-suicide one", () => {
    const r = applyLongFormExclusions([pair("Ay", "Bee", "suicide", "mauled")], { suppressedGamertags: [] });
    expect(r.clusters).toEqual([]);
    expect(r.skipped.suicide_subject).toBe(1);
  });

  it("does not treat a NULL death cause as a suicide", () => {
    const c = buildLongFormClusters(
      [cand({ gamertag: "Ay", endedAt: at(0), x: 0, y: 0, deathCause: null }),
       cand({ gamertag: "Bee", endedAt: at(27), x: 40, y: 0, deathCause: "infected" })], OPTS)[0]!;
    const r = applyLongFormExclusions([c], { suppressedGamertags: [] });
    expect(r.clusters).toHaveLength(1);
    expect(r.skipped.suicide_subject).toBe(0);
  });

  it("drops a cluster containing a suppressed gamertag, case-insensitively", () => {
    const r = applyLongFormExclusions([pair("DevAccount", "Bee", "pvp", "pvp")], { suppressedGamertags: ["devaccount"] });
    expect(r.clusters).toEqual([]);
    expect(r.skipped.suppressed_gamertag).toBe(1);
  });

  it("counts self-cluster before suicide when a cluster trips both", () => {
    const r = applyLongFormExclusions([pair("YrJustBad", "YrJustBad", "suicide", "suicide")], { suppressedGamertags: [] });
    expect(r.skipped).toEqual({ self_cluster: 1, suicide_subject: 0, unqualified_subject: 0, suppressed_gamertag: 0 });
  });

  // Two survive here, not the one the real 7-day dataset yields: suppression is not configured in this
  // fixture, so the dev-account pvp pair is still present. In production NEWSDESK_NEWS_SUPPRESSED_GAMERTAGS
  // removes it, leaving the single GabeFox101/CUPID18 cluster.
  it("removes the four self-clusters from the six verified production pairs", () => {
    const clusters = [
      pair("GabeFox101", "CUPID18", "infected", "died"),
      pair("YrJustBad", "YrJustBad", "suicide", "suicide"),
      pair("YrJustBad", "YrJustBad", "suicide", "suicide"),
      pair("YrJustBad", "YrJustBad", "suicide", "suicide"),
      pair("YrJustBad", "YrJustBad", "suicide", "suicide"),
      pair("YrJustBad", "Cee Lo GREEN 96", "pvp", "pvp"),
    ];
    const r = applyLongFormExclusions(clusters, { suppressedGamertags: [] });
    expect(r.clusters).toHaveLength(2); // 4 self-clusters removed; the two mixed pairs remain
    expect(r.skipped.self_cluster).toBe(4);
  });

  it("returns a zeroed skip record when nothing is excluded", () => {
    const r = applyLongFormExclusions([], { suppressedGamertags: [] });
    expect(r.skipped).toEqual({ self_cluster: 0, suicide_subject: 0, unqualified_subject: 0, suppressed_gamertag: 0 });
  });
});
