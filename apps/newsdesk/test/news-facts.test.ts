import { describe, it, expect } from "vitest";
import type { PlayerPriors, LifeTimeline } from "@onelife/read-models";
import { buildStandingDeadFacts, buildLongFormFacts } from "../src/news-facts.js";
import type { StandingDeadTarget } from "../src/standing-dead-targets.js";
import { buildLongFormClusters } from "../src/long-form-cluster.js";
import type { DeathCandidate } from "../src/long-form-cluster.js";

const priors = (over: Partial<PlayerPriors> = {}): PlayerPriors => ({
  livesLived: 0, longestLifeSeconds: 0, totalKills: 0,
  usualDeathCause: null, lastDeathCause: null, bestLifeMap: null, ...over,
});

/** Minimal LifeTimeline. Cast, matching birth-facts.test.ts: the real type is derived from
 *  getLifeDetail's return and is impractical to build by hand in a pure unit test. */
function timeline(over: Partial<{ playtimeSeconds: number; kills: unknown[]; sessions: unknown[]; character: unknown }> = {}) {
  return {
    life: {
      startedAt: new Date("2026-07-11T00:00:00Z"),
      endedAt: null,
      playtimeSeconds: "playtimeSeconds" in over ? over.playtimeSeconds : 5600,
      deathCause: null,
    },
    sessions: over.sessions ?? [{}, {}],
    kills: over.kills ?? [],
    character: "character" in over ? over.character : { name: "Lewis" },
    qualifiedAt: null, verdict: null, ordeals: null, hpLow: null,
  } as unknown as LifeTimeline;
}

const sdTarget: StandingDeadTarget = {
  lifeId: 4242, serverId: 7, gamertag: "GabeFox101",
  map: "chernarusplus", mapSlug: "chernarus", lifeNumber: 3,
  lifeStartedAt: new Date("2026-07-11T00:00:00Z"), playtimeSeconds: 5600,
  lastSeenAt: new Date("2026-07-14T00:00:00Z"),
  eligibleAt: new Date("2026-07-17T00:00:00Z"),
  idleSeconds: 4 * 86_400,   // 96h
  priorLives: 2, hitsAbsorbed: 137,
  naturalKey: "standing_dead:7:GabeFox101:2026-07-11T00:00:00.000Z",
};

describe("buildStandingDeadFacts", () => {
  it("carries the trigger, the natural key, and a single subject", () => {
    const f = buildStandingDeadFacts(sdTarget, timeline(), priors({ livesLived: 2, totalKills: 4 }));
    expect(f.trigger).toBe("standing_dead");
    expect(f.naturalKey).toBe("standing_dead:7:GabeFox101:2026-07-11T00:00:00.000Z");
    expect(f.primaryGamertag).toBe("GabeFox101");
    expect(f.subjectCount).toBe(1);
    expect(f.subjects).toHaveLength(1);
    expect(f.subjects[0]!.gamertag).toBe("GabeFox101");
    expect(f.subjects[0]!.persona).toBe("Lewis");
    expect(f.subjects[0]!.sessions).toBe(2);
    expect(f.serverId).toBe(7);
    expect(f.map).toBe("chernarusplus");
    expect(f.mapSlug).toBe("chernarus");
  });

  it("reports PLAYTIME as survival time, never the wall clock", () => {
    // The life started 2026-07-11 and was last seen 2026-07-14 — three wall-clock days — on
    // 5600 seconds of actual play. Publishing the calendar gap as endurance would be a lie.
    const f = buildStandingDeadFacts(sdTarget, timeline({ playtimeSeconds: 5600 }), priors());
    expect(f.timeAliveSeconds).toBe(5600);
    expect(f.subjects[0]!.timeAliveSeconds).toBe(5600);
    expect(f.subjects[0]!.timeAliveLabel).toBe("1h 33m");
    const blob = JSON.stringify(f);
    expect(blob).not.toContain("259200");  // 3 days of wall clock, in seconds
    // NOTE: do NOT also assert the absence of 345600. `idleSeconds` is a REQUIRED field (spec
    // §4.1.4 — the idle duration, labelled honestly as idle time), the very next test asserts it,
    // and Task 11's rail asserts it on a built object. Banning its value here would push an
    // implementer to delete the field to make this pass.
    expect(f.timeAliveSeconds).not.toBe(f.idleSeconds);
  });

  it("keeps idle time as its own field, in hours and seconds", () => {
    const f = buildStandingDeadFacts(sdTarget, timeline(), priors());
    expect(f.idleSeconds).toBe(345_600);
    expect(f.idleHours).toBe(96);
    expect(f.lastSeenAt).toBe("2026-07-14T00:00:00.000Z");
    expect(f.eligibleAt).toBe("2026-07-17T00:00:00.000Z");
  });

  it("passes the earned-coverage evidence through for the image gates", () => {
    const f = buildStandingDeadFacts(sdTarget, timeline(), priors({ livesLived: 2, totalKills: 4 }));
    expect(f.hitsAbsorbed).toBe(137);
    expect(f.priors.livesLived).toBe(2);
    expect(f.lifeNumber).toBe(3);
  });

  it("marks a first-life, zero-kill subject fresh and a veteran not", () => {
    expect(buildStandingDeadFacts(sdTarget, timeline(), priors()).allFreshSubjects).toBe(true);
    expect(buildStandingDeadFacts(sdTarget, timeline({ kills: [{}] }), priors()).allFreshSubjects).toBe(false);
    expect(buildStandingDeadFacts(sdTarget, timeline(), priors({ livesLived: 1 })).allFreshSubjects).toBe(false);
    expect(buildStandingDeadFacts(sdTarget, timeline(), priors({ totalKills: 1 })).allFreshSubjects).toBe(false);
  });

  it("leaves the Long Form fields null", () => {
    const f = buildStandingDeadFacts(sdTarget, timeline(), priors());
    expect(f.earliestDeathAt).toBeNull();
    expect(f.spanSeconds).toBeNull();
    expect(f.subjects[0]!.endedAt).toBeNull();
  });
});

// Real coordinate-bearing candidates, run through the real clique builder — the source rows DO
// carry x/y, exactly as the §11 rail requires.
const cand = (over: Partial<DeathCandidate>): DeathCandidate => ({
  lifeId: 1, serverId: 7, gamertag: "A", map: "chernarusplus", mapSlug: "chernarus",
  lifeNumber: 1, lifeStartedAt: new Date("2026-07-11T00:00:00Z"),
  endedAt: new Date("2026-07-11T01:00:00Z"), deathCause: "infected",
  x: 7423.51, y: 9210.88, fixAt: new Date("2026-07-11T01:00:00Z"), ...over,
});

function longFormFixture() {
  const a = cand({ lifeId: 11, gamertag: "CUPID18", endedAt: new Date("2026-07-11T01:00:00Z"), x: 7423.51, y: 9210.88 });
  const b = cand({ lifeId: 12, gamertag: "GabeFox101", endedAt: new Date("2026-07-11T01:00:27Z"), x: 7443.19, y: 9245.02, deathCause: "died" });
  const [cluster] = buildLongFormClusters([a, b], { windowSeconds: 180, radiusMeters: 100 });
  const per = new Map([
    ["CUPID18", { timeline: timeline({ playtimeSeconds: 6660 }), priors: priors() }],
    ["GabeFox101", { timeline: timeline({ playtimeSeconds: 6700 }), priors: priors() }],
  ]);
  return { cluster: cluster!, per };
}

describe("buildLongFormFacts", () => {
  it("carries every subject, the cluster key, and the primary", () => {
    const { cluster, per } = longFormFixture();
    const f = buildLongFormFacts(cluster, per);
    expect(f.trigger).toBe("long_form");
    expect(f.subjectCount).toBe(2);
    expect(f.subjects.map((s) => s.gamertag)).toEqual(["CUPID18", "GabeFox101"]);
    expect(f.primaryGamertag).toBe("CUPID18");  // earliest ended_at
    expect(f.naturalKey).toBe(cluster.naturalKey);
    expect(f.earliestDeathAt).toBe("2026-07-11T01:00:00.000Z");
  });

  it("reports the gap between deaths in SECONDS and never a distance", () => {
    const { cluster, per } = longFormFixture();
    const f = buildLongFormFacts(cluster, per);
    expect(f.spanSeconds).toBe(27);
    expect(JSON.stringify(f)).not.toMatch(/\d{4}\.\d/);
  });

  it("flags a cluster of first-lifers, and drops the flag when one has a record", () => {
    const { cluster, per } = longFormFixture();
    expect(buildLongFormFacts(cluster, per).allFreshSubjects).toBe(true);
    per.set("GabeFox101", { timeline: timeline({ playtimeSeconds: 6700 }), priors: priors({ livesLived: 3 }) });
    expect(buildLongFormFacts(cluster, per).allFreshSubjects).toBe(false);
  });

  it("carries no absorbed-hit count — that is a Standing Dead signal only", () => {
    const { cluster, per } = longFormFixture();
    expect(buildLongFormFacts(cluster, per).hitsAbsorbed).toBe(0);
    expect(buildLongFormFacts(cluster, per).idleHours).toBeNull();
    expect(buildLongFormFacts(cluster, per).idleSeconds).toBeNull();
  });

  it("throws rather than publish a cluster with a missing subject timeline", () => {
    const { cluster, per } = longFormFixture();
    per.delete("GabeFox101");
    expect(() => buildLongFormFacts(cluster, per)).toThrow(/GabeFox101/);
  });

  it("preserves each subject's own death cause and end instant", () => {
    const { cluster, per } = longFormFixture();
    const f = buildLongFormFacts(cluster, per);
    const gabe = f.subjects.find((s) => s.gamertag === "GabeFox101")!;
    expect(gabe.deathCause).toBe("died");
    expect(gabe.endedAt).toBe("2026-07-11T01:00:27.000Z");
  });
});
