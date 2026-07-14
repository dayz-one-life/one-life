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
    expect(q).toEqual({ at: min(2), by: "kill" });
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
