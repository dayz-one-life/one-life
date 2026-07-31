import { describe, expect, test } from "vitest";
import { buildTimeline } from "./life-timeline";
import type { LifeTimelineData } from "./types";

const start = "2026-07-14T00:00:00Z";
const at = (mins: number) => new Date(Date.parse(start) + mins * 60_000).toISOString();

function data(over: Partial<LifeTimelineData> = {}): LifeTimelineData {
  return {
    gamertag: "YrJustBad",
    map: "sakhal",
    slug: "sakhal",
    lastSeenAt: null,
    life: {
      id: 1, serverId: 1, playerId: 1, lifeNumber: 4,
      startedAt: start, endedAt: null,
      deathCause: null, deathByGamertag: null, deathWeapon: null, deathDistance: null,
      energyAtDeath: null, waterAtDeath: null, bleedSourcesAtDeath: null,
      playtimeSeconds: 0,
    },

    sessions: [
      { id: 1, serverId: 1, playerId: 1, lifeId: 1, connectedAt: at(0), disconnectedAt: at(120), durationSeconds: 7200, closeReason: "d" },
      { id: 2, serverId: 1, playerId: 1, lifeId: 1, connectedAt: at(200), disconnectedAt: at(300), durationSeconds: 6000, closeReason: "d" },
      { id: 3, serverId: 1, playerId: 1, lifeId: 1, connectedAt: at(400), disconnectedAt: null, durationSeconds: null, closeReason: null },
    ],
    kills: [
      { victimGamertag: "Twhizzle4life", weapon: "KAS-74U", distanceMeters: 25, occurredAt: at(430) },
      { victimGamertag: "Tomahawked11", weapon: "VSS", distanceMeters: 5, occurredAt: at(90) },
    ],
    qualifiedAt: { at: at(5), by: "playtime" },
    encounters: [],
    verdict: null,
    avatarHash: null,
    obituarySlug: null,
    ...over,
  };
}

describe("buildTimeline", () => {
  test("alive life: newest-first, NOW row first, birth last", () => {
    const now = new Date(Date.parse(start) + 500 * 60_000);
    const v = buildTimeline(data(), now);
    expect(v.alive).toBe(true);
    expect(v.events[0]!.kind).toBe("now");
    expect(v.events[v.events.length - 1]!.kind).toBe("birth");
    // Birth event has timeLabel "0h 00m"
    const birth = v.events.find((e) => e.kind === "birth");
    expect(birth && "timeLabel" in birth ? birth.timeLabel : "").toBe("0h 00m");
  });

  test("groups quiet consecutive sessions (no kill inside) into a session-group", () => {
    // sessions 2 (200-300) has no kill; but it's a single quiet run of length 1 -> stays "session"
    // make sessions 2 & 3 both quiet by removing kills to force a group
    const now = new Date(Date.parse(start) + 500 * 60_000);
    const v = buildTimeline(data({ kills: [] }), now);
    const group = v.events.find((e) => e.kind === "session-group");
    expect(group).toBeTruthy();
    expect(group && "title" in group ? group.title : "").toBe("Sessions 2–3");
  });

  test("session containing a kill stays its own row", () => {
    const now = new Date(Date.parse(start) + 500 * 60_000);
    const v = buildTimeline(data(), now); // session 3 (400-now) contains kill @430
    const s3 = v.events.find((e) => e.kind === "session" && "title" in e && e.title === "Session 3 began");
    expect(s3).toBeTruthy();
  });

  test("marks the max-distance kill as the longest (tie -> earliest)", () => {
    const now = new Date(Date.parse(start) + 500 * 60_000);
    const v = buildTimeline(data(), now);
    const longest = v.events.filter((e) => e.kind === "kill" && e.longestKill);
    expect(longest).toHaveLength(1);
    expect(longest[0] && "victimGamertag" in longest[0] ? longest[0].victimGamertag : "").toBe("Twhizzle4life"); // 25m > 5m
    // Kill at wall-clock +430m, but only 3h 40m of it was PLAYED: session 1 (2h) + session 2
    // (1h 40m). The 3h 20m logged off does not count, and session 3 is open with NO heartbeat
    // (`lastSeenAt: null`), so it accrues nothing — the same floor `liveTimeAlive` applies.
    expect(longest[0] && "timeLabel" in longest[0] ? longest[0].timeLabel : "").toBe("3h 40m in");
    expect(v.hero.timeAliveSeconds).toBe(13_200); // and the hero agrees, to the second
  });

  test("hero stats: kills, longest, sessions, qualified true", () => {
    const now = new Date(Date.parse(start) + 500 * 60_000);
    const v = buildTimeline(data(), now);
    expect(v.hero.kills).toBe(2);
    expect(v.hero.longestKillMeters).toBe(25);
    expect(v.hero.sessions).toBe(3);
    expect(v.hero.qualified).toBe(true);
  });

  test("dead life: death row (not now), vitals line, no qualified row when qualifiedAt null", () => {
    const now = new Date(Date.parse(start) + 400 * 60_000);
    const v = buildTimeline(
      data({
        qualifiedAt: null,
        life: {
          ...data().life, endedAt: at(360), deathCause: "pvp", deathByGamertag: "SomeKiller",
          deathWeapon: "VSD", deathDistance: 126, energyAtDeath: 42, waterAtDeath: 18, bleedSourcesAtDeath: 2,
          playtimeSeconds: 21600,
        },
      }),
      now,
    );
    expect(v.alive).toBe(false);
    expect(v.events.some((e) => e.kind === "now")).toBe(false);
    const death = v.events.find((e) => e.kind === "death");
    expect(death && "vitals" in death ? death.vitals : "").toBe("Energy 42 · Water 18 · bleeding ×2");
    expect(v.events.some((e) => e.kind === "qualified")).toBe(false);
    expect(v.hero.qualified).toBe(false);
  });

  test("qualified caption reflects the reason", () => {
    const now = new Date(Date.parse(start) + 500 * 60_000);
    const v = buildTimeline(data({ qualifiedAt: { at: at(120), by: "kill" } }), now);
    const q = v.events.find((e) => e.kind === "qualified");
    expect(q && "line" in q ? q.line : "").toMatch(/first blood/i);
    // Qualified at +120m, which lands at the very end of session 1 — 2h played either way.
    expect(q && "timeLabel" in q ? q.timeLabel : "").toBe("2h 00m in");
  });

  /**
   * ⚠️ Offsets are PLAYED time, not wall-clock time since `startedAt`. A life spanning two weeks
   * of real time but three hours of play used to label its events "463h 04m in" while the hero
   * read "TIME ALIVE 3h 35m" — two different clocks on one axis, which read as broken data. Every
   * offset here counts only time inside a session, so the terminal row equals the hero stat.
   */
  describe("offsets are played time, not wall clock", () => {
    test("an event in the gap between sessions counts only the sessions that closed before it", () => {
      const now = new Date(Date.parse(start) + 500 * 60_000);
      // +150m is wall-clock 2h 30m in, but sits in the logged-off gap after session 1 (0–120):
      // only session 1's 2h has been played.
      const v = buildTimeline(data({ qualifiedAt: { at: at(150), by: "kill" } }), now);
      const q = v.events.find((e) => e.kind === "qualified");
      expect(q && "timeLabel" in q ? q.timeLabel : "").toBe("2h 00m in");
    });

    test("an event inside a session is pro-rated from that session's connect", () => {
      const now = new Date(Date.parse(start) + 500 * 60_000);
      // +250m sits 50m into session 2 (200–300): 2h from session 1 plus 50m = 2h 50m.
      const v = buildTimeline(data({ qualifiedAt: { at: at(250), by: "kill" } }), now);
      const q = v.events.find((e) => e.kind === "qualified");
      expect(q && "timeLabel" in q ? q.timeLabel : "").toBe("2h 50m in");
    });

    test("the death row's offset equals the hero's time alive", () => {
      const now = new Date(Date.parse(start) + 500 * 60_000);
      const v = buildTimeline(
        data({
          kills: [],
          life: { ...data().life, endedAt: at(430), playtimeSeconds: 15_000 },
        }),
        now,
      );
      const death = v.events.find((e) => e.kind === "death");
      expect(death && "timeLabel" in death ? death.timeLabel : "").toBe("4h 10m in");
      expect(v.hero.timeAliveSeconds).toBe(15_000);
    });

    test("an open session accrues only to lastSeenAt, matching liveTimeAlive", () => {
      const now = new Date(Date.parse(start) + 540 * 60_000);
      const v = buildTimeline(
        data({
          sessions: [{ id: 1, serverId: 1, playerId: 1, lifeId: 1, connectedAt: start, disconnectedAt: null, durationSeconds: null, closeReason: null }],
          kills: [{ victimGamertag: "Tomahawked11", weapon: "VSS", distanceMeters: 5, occurredAt: at(480) }],
          lastSeenAt: at(300),
        }),
        now,
      );
      const kill = v.events.find((e) => e.kind === "kill");
      // The kill is at +8h of wall clock, but the heartbeat stopped at +5h — the offset is capped
      // there rather than climbing to request-time `now`, exactly as the hero stat is.
      expect(kill && "timeLabel" in kill ? kill.timeLabel : "").toBe("5h 00m in");
      expect(v.hero.timeAliveSeconds).toBe(5 * 3600);
    });
  });

  test("caps live time-alive at lastSeenAt for a crashed/ghosted session — not request-time now", () => {
    // Life started 9h before `now`; last heartbeat was 4h before `now` (5h after life start).
    const now = new Date(Date.parse(start) + 540 * 60_000); // +9h
    const lastSeenAt = at(300); // +5h from start = 4h before now
    const d = data({
      sessions: [{ id: 1, serverId: 1, playerId: 1, lifeId: 1, connectedAt: start, disconnectedAt: null, durationSeconds: null, closeReason: null }],
      kills: [],
      qualifiedAt: { at: at(5), by: "playtime" },
      lastSeenAt,
    });
    const v = buildTimeline(d, now);
    // Capped at lastSeenAt (5h), NOT at now (9h).
    expect(v.hero.timeAliveSeconds).toBe(5 * 3600);
    const nowRow = v.events.find((e) => e.kind === "now");
    expect(nowRow).toBeTruthy();
    const line = nowRow && "line" in nowRow ? nowRow.line : "";
    expect(line).toBe("5h 0m");
    expect(line).not.toMatch(/and counting/i);
  });

  test("still-online control: lastSeenAt ≈ now yields the full elapsed time, unchanged", () => {
    const now = new Date(Date.parse(start) + 540 * 60_000); // +9h
    const d = data({
      sessions: [{ id: 1, serverId: 1, playerId: 1, lifeId: 1, connectedAt: start, disconnectedAt: null, durationSeconds: null, closeReason: null }],
      kills: [],
      qualifiedAt: { at: at(5), by: "playtime" },
      lastSeenAt: now.toISOString(),
    });
    const v = buildTimeline(d, now);
    expect(v.hero.timeAliveSeconds).toBe(9 * 3600);
    const nowRow = v.events.find((e) => e.kind === "now");
    const line = nowRow && "line" in nowRow ? nowRow.line : "";
    expect(line).toBe("9h 0m");
  });

  test("clock skew: lastSeenAt a few seconds AFTER now is not clamped — matches survivors.ts (lastSeenAt, no clamp to now)", () => {
    // A still-online player whose heartbeat is a few seconds ahead of request-time `now`
    // (game-server-vs-app clock skew). survivors.ts's `upTo = lastSeenAt ?? connectedAt ?? now`
    // has no clamp, so it would accrue straight through to lastSeenAt; this page must match.
    const now = new Date(Date.parse(start) + 540 * 60_000); // +9h
    const lastSeenAt = new Date(now.getTime() + 5_000).toISOString(); // 5s AFTER now
    const d = data({
      sessions: [{ id: 1, serverId: 1, playerId: 1, lifeId: 1, connectedAt: start, disconnectedAt: null, durationSeconds: null, closeReason: null }],
      kills: [],
      qualifiedAt: { at: at(5), by: "playtime" },
      lastSeenAt,
    });
    const v = buildTimeline(d, now);
    // Not clamped to `now` (9h = 32400s) — accrues through to lastSeenAt (9h + 5s = 32405s).
    expect(v.hero.timeAliveSeconds).toBe(9 * 3600 + 5);
  });

  test("threads the verdict onto the death event", () => {
    const now = new Date(Date.parse(start) + 400 * 60_000);
    const deadData = data({
      qualifiedAt: null,
      verdict: { cause: "starvation", confidence: "low", conditions: ["starving"] },
      life: {
        ...data().life, endedAt: at(360), deathCause: "environment", deathByGamertag: null,
        deathWeapon: null, deathDistance: null, energyAtDeath: 0, waterAtDeath: 10, bleedSourcesAtDeath: 0,
        playtimeSeconds: 21600,
      },
    });
    const view = buildTimeline(deadData, now);
    const death = view.events.find((e) => e.kind === "death")!;
    expect(death.kind === "death" && death.verdict).toEqual({ cause: "starvation", confidence: "low", conditions: ["starving"] });
  });

  test("interleaves encounters with the exact copy per category", () => {
    const now = new Date(Date.parse(start) + 500 * 60_000);
    const v = buildTimeline(
      data({
        encounters: [
          { category: "wolf", attackerGamertag: null, startedAt: at(1), durationSeconds: 120, hits: 7, hpLow: 34 },
          { category: "infected", attackerGamertag: null, startedAt: at(5), durationSeconds: 240, hits: 12, hpLow: 21 },
          { category: "infected", attackerGamertag: null, startedAt: at(15), durationSeconds: 0, hits: 2, hpLow: null },
          { category: "player", attackerGamertag: "Raider", startedAt: at(10), durationSeconds: 30, hits: 3, hpLow: 58 },
        ],
      }),
      now,
    );
    const enc = v.events.filter((e) => e.kind === "encounter");
    expect(enc.map((e) => e.title)).toEqual(
      expect.arrayContaining(["Wolves — fought off", "Horde — 12 blows over 4m", "Infected — 2 blows", "Firefight"]),
    );
    const wolf = enc.find((e) => e.title.startsWith("Wolves"))!;
    expect(wolf.line).toBe("7 blows over 2m · HP down to 34");
    const two = enc.find((e) => e.title === "Infected — 2 blows")!;
    expect(two.line).toBe("2 blows"); // no HP → never fabricated
    const pvp = enc.find((e) => e.title === "Firefight")!;
    expect(pvp.kind === "encounter" && pvp.attackerGamertag).toBe("Raider");
    expect(pvp.line).toBe("3 hits taken · HP 58");
  });

  test("renders no encounter rows for an encounter-free life", () => {
    const now = new Date(Date.parse(start) + 500 * 60_000);
    const v = buildTimeline(data({ encounters: [] }), now);
    expect(v.events.some((e) => e.kind === "encounter")).toBe(false);
  });
});
