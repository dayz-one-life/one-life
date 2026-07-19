import { describe, it, expect } from "vitest";
import type { PlayerPriors, LifeTimeline } from "@onelife/read-models";
import { buildStandingDeadFacts, buildLongFormFacts } from "../src/news-facts.js";
import type { StandingDeadTarget } from "../src/standing-dead-targets.js";
import { buildLongFormClusters } from "../src/long-form-cluster.js";
import type { DeathCandidate } from "../src/long-form-cluster.js";
import { buildNewsPrompt, NEWS_PROMPT_VERSION } from "../src/news-prompt.js";

/** Every key at every depth of a built object. The Fog Rule, the no-row-ids rule and the cut
 *  emote slot are all key-PRESENCE properties: a value regex like /\d{4}\.\d/ misses a short
 *  coordinate (e.g. x=812.4) and misses a null field entirely. */
function keysDeep(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) {
    for (const e of v) keysDeep(e, out);
    return out;
  }
  if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out.add(k);
      keysDeep(val, out);
    }
  }
  return out;
}

const priors = (over: Partial<PlayerPriors> = {}): PlayerPriors => ({
  livesLived: 0, longestLifeSeconds: 0, totalKills: 0,
  usualDeathCause: null, lastDeathCause: null, bestLifeMap: null, ...over,
});

function timeline(playtimeSeconds: number) {
  return {
    life: { startedAt: new Date("2026-07-11T00:00:00Z"), endedAt: null, playtimeSeconds, deathCause: null },
    sessions: [{}, {}], kills: [], character: { name: "Lewis" },
    qualifiedAt: null, verdict: null, ordeals: null, hpLow: null,
  } as unknown as LifeTimeline;
}

const sdTarget: StandingDeadTarget = {
  lifeId: 987_654, serverId: 7, gamertag: "GabeFox101",
  map: "chernarusplus", mapSlug: "chernarus", lifeNumber: 3,
  lifeStartedAt: new Date("2026-07-11T00:00:00Z"), playtimeSeconds: 5600,
  lastSeenAt: new Date("2026-07-18T00:00:00Z"),
  eligibleAt: new Date("2026-07-21T00:00:00Z"),
  idleSeconds: 4 * 86_400, priorLives: 2, hitsAbsorbed: 137,
  naturalKey: "standing_dead:7:GabeFox101:2026-07-11T00:00:00.000Z",
};

// SOURCE rows that genuinely carry coordinates, including a SHORT one that a four-digit regex
// would sail straight past.
const cand = (over: Partial<DeathCandidate>): DeathCandidate => ({
  lifeId: 555_111, serverId: 7, gamertag: "A", map: "chernarusplus", mapSlug: "chernarus",
  lifeNumber: 1, lifeStartedAt: new Date("2026-07-11T00:00:00Z"),
  endedAt: new Date("2026-07-11T01:00:00Z"), deathCause: "infected",
  x: 812.4, y: 9210.88, fixAt: new Date("2026-07-11T01:00:00Z"), ...over,
});

function longFormFacts() {
  const a = cand({ lifeId: 555_111, gamertag: "CUPID18", x: 812.4, y: 9210.88 });
  const b = cand({ lifeId: 555_222, gamertag: "GabeFox101", x: 838.1, y: 9245.02,
    endedAt: new Date("2026-07-11T01:00:27Z"), deathCause: "died" });
  const [cluster] = buildLongFormClusters([a, b], { windowSeconds: 180, radiusMeters: 100 });
  return buildLongFormFacts(cluster!, new Map([
    ["CUPID18", { timeline: timeline(6660), priors: priors() }],
    ["GabeFox101", { timeline: timeline(6700), priors: priors() }],
  ]));
}

const sdFacts = () => buildStandingDeadFacts(sdTarget, timeline(5600), priors({ livesLived: 2, totalKills: 4 }));

describe("RAIL — the Fog Rule, asserted on the OUTPUT", () => {
  it("a built NewsFacts has no coordinate-shaped key, for either trigger", () => {
    const forbidden = /^(x|y|z|lat|lng|lon|coord|coords|coordinate|coordinates|pos|position|positions|fix|fixat|grid|landmark|region|town|locale|route|bearing|heading|distancemeters|distancemetres|radius|metres|meters)$/i;
    for (const facts of [sdFacts(), longFormFacts()]) {
      const offenders = [...keysDeep(facts)].filter((k) => forbidden.test(k));
      expect(offenders).toEqual([]);
    }
  });

  it("the SOURCE rows really did carry coordinates — the rail is not vacuous", () => {
    const c = cand({});
    expect(typeof c.x).toBe("number");
    expect(typeof c.y).toBe("number");
    const facts = longFormFacts();
    const blob = JSON.stringify(facts);
    expect(blob).not.toContain("812.4");      // short coordinate a /\d{4}\.\d/ regex would miss
    expect(blob).not.toContain("9210.88");
    expect(blob).not.toMatch(/\d{4}\.\d/);
  });

  it("no rendered prompt leaks a coordinate either", () => {
    for (const facts of [sdFacts(), longFormFacts()]) {
      const { user } = buildNewsPrompt(facts);
      expect(user).not.toContain("812.4");
      expect(user).not.toContain("9210.88");
      expect(user).not.toMatch(/\d{4}\.\d/);
    }
  });
});

describe("RAIL — EmoteSuicide never reaches a fact payload", () => {
  it("no emote-shaped key exists anywhere in a built NewsFacts", () => {
    // STRUCTURAL, by design. The expressive-emote slot of spec §4.1.4 was CUT: the allowlist
    // covers ~49 events corpus-wide (no signal), and reaching it means reading events.payload —
    // the same column holding the coordinates the rail above exists to keep out. With no emote
    // field at all, EmoteSuicide cannot reach a payload by any path.
    for (const facts of [sdFacts(), longFormFacts()]) {
      expect([...keysDeep(facts)].filter((k) => /emote/i.test(k))).toEqual([]);
    }
    expect(JSON.stringify(longFormFacts())).not.toMatch(/emote/i);
  });
});

describe("RAIL — never print wall-clock as survival time", () => {
  it("uses playtime_seconds even when the wall clock is 30x larger", () => {
    // The life began 2026-07-11 and was last seen 2026-07-18: 7 wall-clock days against 5600
    // seconds of actual play. Publishing the calendar figure as endurance would be the paper's
    // first outright lie.
    const f = sdFacts();
    expect(f.timeAliveSeconds).toBe(5600);
    expect(f.subjects[0]!.timeAliveSeconds).toBe(5600);
    const blob = JSON.stringify(f);
    expect(blob).not.toContain("604800");   // 7 days in seconds
    // Idle time is present, but ONLY under its own explicitly-named fields.
    expect(f.idleSeconds).toBe(345_600);
    const { user } = buildNewsPrompt(f);
    expect(user).toMatch(/1h 33m/);
    expect(user).toMatch(/IDLE TIME/);
    expect(user).toMatch(/never present the calendar gap as time survived/i);
  });
});

describe("RAIL — no row ids in durable fields", () => {
  it("a built NewsFacts carries no lives.id / players.id, only rebuild-stable identity", () => {
    // `articles` survives `deploy.sh --rebuild`; `lives` and `players` do not. A persisted row id
    // is a dangling pointer the first time anyone rebuilds the projections.
    const forbidden = /^(id|lifeid|playerid|articleid|killid|sessionid|characterid)$/i;
    for (const facts of [sdFacts(), longFormFacts()]) {
      expect([...keysDeep(facts)].filter((k) => forbidden.test(k))).toEqual([]);
    }
  });

  it("the transient lifeId on the TARGET really exists — the rail is not vacuous", () => {
    expect(sdTarget.lifeId).toBe(987_654);
    expect(JSON.stringify(sdFacts())).not.toContain("987654");
    expect(JSON.stringify(longFormFacts())).not.toContain("555111");
    expect(JSON.stringify(longFormFacts())).not.toContain("555222");
  });

  it("`serverId` IS allowed — `servers` is durable and is not truncated by a rebuild", () => {
    expect(sdFacts().serverId).toBe(7);
  });
});

describe("RAIL — gamertags verbatim", () => {
  it("never lowercases a gamertag in the key or the facts", () => {
    const f = sdFacts();
    expect(f.primaryGamertag).toBe("GabeFox101");
    expect(f.subjects[0]!.gamertag).toBe("GabeFox101");
    expect(f.naturalKey).toContain("GabeFox101");
    expect(f.naturalKey).not.toContain("gabefox101");
  });
});

describe("RAIL — forbidden real-player framing", () => {
  it("every prompt bans the four framings by name plus second-person address", () => {
    for (const facts of [sdFacts(), longFormFacts()]) {
      const lower = buildNewsPrompt(facts).user.toLowerCase();
      for (const token of ["the player", "logged off", "stopped playing", "lost interest"]) {
        expect(lower).toContain(token);
      }
      expect(lower).toContain("second person");
    }
  });
});

describe("RAIL — the prompt version is pinned", () => {
  it("is exactly news-v1", () => {
    expect(NEWS_PROMPT_VERSION).toBe("news-v1");
  });
});
