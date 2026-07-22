import { describe, it, expect } from "vitest";
import { planBans, planExpiries, type EndedLife } from "../src/decide.js";

const base: EndedLife = {
  serverId: 1,
  gamertag: "Steveo12491",
  dayzId: null,
  startedAt: new Date("2026-07-11T10:00:00Z"),
  endedAt: new Date("2026-07-11T12:00:00Z"),
  deathCause: "infected",
  effectivePlaytimeSeconds: 0,
  playerKills: [],
};

describe("planBans", () => {
  it("plans a 24h ban for a life qualified by playtime (>=300s)", () => {
    const plans = planBans([{ ...base, effectivePlaytimeSeconds: 400 }], 24);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ serverId: 1, gamertag: "Steveo12491", qualifiedBy: "playtime", lifeStartedAt: base.startedAt, bannedAt: base.endedAt });
    expect(plans[0]!.expiresAt.toISOString()).toBe("2026-07-12T12:00:00.000Z");
  });

  it("plans a ban for a life qualified by a kill in-window", () => {
    const plans = planBans([{ ...base, effectivePlaytimeSeconds: 10, playerKills: [{ occurredAt: new Date("2026-07-11T11:00:00Z") }] }], 24);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.qualifiedBy).toBe("kill");
  });

  it("plans a ban for a PvP death", () => {
    const plans = planBans([{ ...base, deathCause: "pvp", effectivePlaytimeSeconds: 10 }], 24);
    expect(plans[0]!.qualifiedBy).toBe("pvp-death");
  });

  it("does NOT plan a ban for an unqualified life (<300s, no kill, non-pvp death)", () => {
    const plans = planBans([{ ...base, effectivePlaytimeSeconds: 120 }], 24);
    expect(plans).toEqual([]);
  });

  it("uses BAN_DURATION_HOURS for expiry", () => {
    const plans = planBans([{ ...base, effectivePlaytimeSeconds: 400 }], 12);
    expect(plans[0]!.expiresAt.toISOString()).toBe("2026-07-12T00:00:00.000Z");
  });

  it("carries dayzId from the life onto the plan", () => {
    const life = {
      serverId: 1, gamertag: "Ronald", dayzId: "ABC123",
      startedAt: new Date("2026-07-20T00:00:00Z"),
      endedAt: new Date("2026-07-20T02:00:00Z"),
      deathCause: "pvp", effectivePlaytimeSeconds: 7200, playerKills: [],
    };
    expect(planBans([life], 24)[0]!.dayzId).toBe("ABC123");
  });

  it("carries a null dayzId through rather than dropping the ban", () => {
    const life = {
      serverId: 1, gamertag: "Ronald", dayzId: null,
      startedAt: new Date("2026-07-20T00:00:00Z"),
      endedAt: new Date("2026-07-20T02:00:00Z"),
      deathCause: "pvp", effectivePlaytimeSeconds: 7200, playerKills: [],
    };
    const plans = planBans([life], 24);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.dayzId).toBeNull();
  });
});

describe("planExpiries", () => {
  const now = new Date("2026-07-12T12:00:00Z");
  it("returns only ids whose expiresAt is at or before now", () => {
    const ids = planExpiries(
      [
        { id: 1, expiresAt: new Date("2026-07-12T11:00:00Z") }, // due
        { id: 2, expiresAt: new Date("2026-07-12T12:00:00Z") }, // due (==)
        { id: 3, expiresAt: new Date("2026-07-12T13:00:00Z") }, // not yet
        { id: 4, expiresAt: null },                              // permanent, never
      ],
      now,
    );
    expect(ids).toEqual([1, 2]);
  });
});
