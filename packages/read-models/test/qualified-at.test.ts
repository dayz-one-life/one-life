import { describe, it, expect } from "vitest";
import { lifeQualifiedAt, isLifeQualified, QUALIFY_SECONDS, livePlaytime } from "../src/qualified.js";

const T0 = new Date("2026-07-10T10:00:00Z");
const min = (n: number) => new Date(T0.getTime() + n * 60_000);

describe("lifeQualifiedAt", () => {
  it("interpolates the crossing moment inside a single long session", () => {
    const q = lifeQualifiedAt({
      startedAt: T0, endedAt: null, deathCause: null,
      sessions: [{ connectedAt: T0, disconnectedAt: min(30), durationSeconds: 1800 }],
      lastSeenAt: min(30), playerKills: [],
    });
    expect(q).toEqual({ at: min(5), by: "playtime" }); // 300s into the session
  });

  it("accumulates playtime across sessions and crosses mid-second-session", () => {
    const q = lifeQualifiedAt({
      startedAt: T0, endedAt: null, deathCause: null,
      sessions: [
        { connectedAt: T0, disconnectedAt: min(3), durationSeconds: 180 },       // 3 min
        { connectedAt: min(60), disconnectedAt: min(70), durationSeconds: 600 }, // crosses at +2 min in
      ],
      lastSeenAt: min(70), playerKills: [],
    });
    expect(q).toEqual({ at: min(62), by: "playtime" }); // 180s accumulated, needs 120s more
  });

  it("caps an open session at last_seen_at — a ghost never crosses", () => {
    const q = lifeQualifiedAt({
      startedAt: T0, endedAt: null, deathCause: null,
      sessions: [{ connectedAt: T0, disconnectedAt: null, durationSeconds: null }],
      lastSeenAt: min(4), // only 4 observed minutes, then silence
      playerKills: [],
    });
    expect(q).toBeNull();
  });

  it("open session with lastSeenAt past the threshold crosses at the interpolated moment", () => {
    const q = lifeQualifiedAt({
      startedAt: T0, endedAt: null, deathCause: null,
      sessions: [{ connectedAt: T0, disconnectedAt: null, durationSeconds: null }],
      lastSeenAt: min(10),
      playerKills: [],
    });
    expect(q).toEqual({ at: min(5), by: "playtime" });
  });

  it("first kill beats a later playtime crossing", () => {
    const q = lifeQualifiedAt({
      startedAt: T0, endedAt: null, deathCause: null,
      sessions: [{ connectedAt: T0, disconnectedAt: min(30), durationSeconds: 1800 }],
      lastSeenAt: min(30),
      playerKills: [{ occurredAt: min(2) }, { occurredAt: min(20) }],
    });
    expect(q).toEqual({ at: min(2), by: "kill", killBasis: "kill_line" });
  });

  it("a trap kill that qualifies the life says so in killBasis; when it qualifies is unchanged", () => {
    const q = lifeQualifiedAt({
      startedAt: T0, endedAt: null, deathCause: null,
      sessions: [{ connectedAt: T0, disconnectedAt: min(1), durationSeconds: 60 }],
      lastSeenAt: min(1),
      playerKills: [{ occurredAt: min(30), basis: "trap_placement" }, { occurredAt: min(40), basis: "kill_line" }],
    });
    expect(q).toEqual({ at: min(30), by: "kill", killBasis: "trap_placement" });
  });

  it("the basis is that of the earliest kill in the window; a tie goes to the kill line", () => {
    const q = lifeQualifiedAt({
      startedAt: T0, endedAt: null, deathCause: null, sessions: [], lastSeenAt: null,
      playerKills: [{ occurredAt: min(3), basis: "trap_placement" }, { occurredAt: min(3), basis: "kill_line" }],
    });
    expect(q).toEqual({ at: min(3), by: "kill", killBasis: "kill_line" });
  });

  it("a kill line in the grace after the death does not take the basis from a trap kill at the death", () => {
    const d = min(2);
    const q = lifeQualifiedAt({
      startedAt: T0, endedAt: d, deathCause: "explosion", sessions: [], lastSeenAt: null,
      playerKills: [
        { occurredAt: new Date(d.getTime() + 1000), basis: "kill_line" }, // grace window, capped to d
        { occurredAt: d, basis: "trap_placement" },
      ],
    });
    expect(q).toEqual({ at: d, by: "kill", killBasis: "trap_placement" });
  });

  it("ignores kills outside the life window", () => {
    const q = lifeQualifiedAt({
      startedAt: T0, endedAt: min(4), deathCause: "suicide",
      sessions: [{ connectedAt: T0, disconnectedAt: min(4), durationSeconds: 240 }],
      lastSeenAt: min(4),
      playerKills: [{ occurredAt: new Date(T0.getTime() - 60_000) }], // before this life
    });
    expect(q).toBeNull(); // discarded reroll: no kill in window, under 300s
  });

  it("a PvP death at 2 minutes qualifies posthumously at ended_at", () => {
    const q = lifeQualifiedAt({
      startedAt: T0, endedAt: min(2), deathCause: "pvp",
      sessions: [{ connectedAt: T0, disconnectedAt: min(2), durationSeconds: 120 }],
      lastSeenAt: min(2), playerKills: [],
    });
    expect(q).toEqual({ at: min(2), by: "pvp-death" });
  });

  it("crossing works across a midnight-straddling session", () => {
    const late = new Date("2026-07-10T23:58:00Z");
    const q = lifeQualifiedAt({
      startedAt: late, endedAt: null, deathCause: null,
      sessions: [{ connectedAt: late, disconnectedAt: new Date("2026-07-11T00:20:00Z"), durationSeconds: 1320 }],
      lastSeenAt: new Date("2026-07-11T00:20:00Z"), playerKills: [],
    });
    expect(q).toEqual({ at: new Date("2026-07-11T00:03:00Z"), by: "playtime" });
  });

  it("agrees with isLifeQualified: defined iff qualified", () => {
    const cases = [
      { sessions: [{ connectedAt: T0, disconnectedAt: min(10), durationSeconds: 600 }], deathCause: null, endedAt: null, kills: [] },
      { sessions: [{ connectedAt: T0, disconnectedAt: min(4), durationSeconds: 240 }], deathCause: "suicide", endedAt: min(4), kills: [] },
      { sessions: [{ connectedAt: T0, disconnectedAt: min(2), durationSeconds: 120 }], deathCause: "pvp", endedAt: min(2), kills: [] },
      { sessions: [{ connectedAt: T0, disconnectedAt: min(3), durationSeconds: 180 }], deathCause: null, endedAt: null, kills: [{ occurredAt: min(1) }] },
    ];
    for (const c of cases) {
      const lastSeenAt = c.sessions[c.sessions.length - 1]!.disconnectedAt;
      const q = lifeQualifiedAt({
        startedAt: T0, endedAt: c.endedAt, deathCause: c.deathCause,
        sessions: c.sessions, lastSeenAt, playerKills: c.kills,
      });
      const stored = c.sessions.reduce((s, x) => s + (x.durationSeconds ?? 0), 0);
      const legacy = isLifeQualified({
        deathCause: c.deathCause,
        effectivePlaytimeSeconds: c.endedAt ? stored : livePlaytime(stored, null, lastSeenAt),
        startedAt: T0,
        windowEnd: c.endedAt ?? lastSeenAt ?? T0,
        playerKills: c.kills,
      });
      expect(q !== null, JSON.stringify(c)).toBe(legacy);
      if (q) expect(q.at.getTime()).toBeGreaterThanOrEqual(T0.getTime());
    }
    void QUALIFY_SECONDS; // constant shared, not re-declared
  });
});

describe("lifeQualifiedAt — a kill logged just after the killer's own death", () => {
  const sec = (n: number) => new Date(min(2).getTime() + n * 1000);
  const dead = {
    startedAt: T0, endedAt: min(2), deathCause: "explosion" as string | null,
    sessions: [{ connectedAt: T0, disconnectedAt: min(2), durationSeconds: 120 }], lastSeenAt: min(2),
  };

  it("qualifies the ended life by kill, at the moment it ended", () => {
    // Never later than the death: the timeline has nowhere to put an instant after the last row.
    expect(lifeQualifiedAt({ ...dead, playerKills: [{ occurredAt: sec(1) }] })).toEqual({ at: min(2), by: "kill", killBasis: "kill_line" });
    expect(lifeQualifiedAt({ ...dead, playerKills: [{ occurredAt: sec(2) }] })).toEqual({ at: min(2), by: "kill", killBasis: "kill_line" });
  });
  it("does not for a kill past the two-second grace", () => {
    expect(lifeQualifiedAt({ ...dead, playerKills: [{ occurredAt: sec(3) }] })).toBeNull();
  });
  it("a mutual kill still reads as a PvP death, not as a kill", () => {
    expect(lifeQualifiedAt({ ...dead, deathCause: "pvp", playerKills: [{ occurredAt: sec(1) }] })).toEqual({ at: min(2), by: "pvp-death" });
  });
  it("the next life is not qualified by the previous life's posthumous kill", () => {
    const next = { startedAt: sec(1), endedAt: null, deathCause: null, sessions: [], lastSeenAt: null, previousLifeEndedAt: min(2) };
    expect(lifeQualifiedAt({ ...next, playerKills: [{ occurredAt: sec(2) }] })).toBeNull();
    expect(lifeQualifiedAt({ ...next, playerKills: [{ occurredAt: sec(3) }] })).toEqual({ at: sec(3), by: "kill", killBasis: "kill_line" });
  });
  it("agrees with isLifeQualified at every second around the death", () => {
    for (const n of [-1, 0, 1, 2, 3]) {
      const playerKills = [{ occurredAt: sec(n) }];
      const at = lifeQualifiedAt({ ...dead, playerKills });
      const is = isLifeQualified({ deathCause: "explosion", effectivePlaytimeSeconds: 120, startedAt: T0, windowEnd: min(2), playerKills });
      expect(at !== null).toBe(is);
    }
  });
});
