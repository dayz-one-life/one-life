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
    character: null,
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
    verdict: null,
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
});
