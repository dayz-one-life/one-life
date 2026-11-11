import { describe, it, expect } from "vitest";
import { planBans, planExpiries, banNames, namesToRelease, type EndedLife } from "../src/decide.js";

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

// Five minutes after the deaths below: every ban planned here still has most of its time to run.
const NOW = new Date("2026-07-11T12:05:00Z");

describe("planBans", () => {
  it("plans a 24h ban for a life qualified by playtime (>=300s)", () => {
    const plans = planBans([{ ...base, effectivePlaytimeSeconds: 400 }], 24, NOW);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ serverId: 1, gamertag: "Steveo12491", qualifiedBy: "playtime", lifeStartedAt: base.startedAt, bannedAt: base.endedAt });
    expect(plans[0]!.expiresAt.toISOString()).toBe("2026-07-12T12:00:00.000Z");
  });

  it("plans a ban for a life qualified by a kill in-window", () => {
    const plans = planBans([{ ...base, effectivePlaytimeSeconds: 10, playerKills: [{ occurredAt: new Date("2026-07-11T11:00:00Z") }] }], 24, NOW);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.qualifiedBy).toBe("kill");
  });

  it("plans a ban for a PvP death", () => {
    const plans = planBans([{ ...base, deathCause: "pvp", effectivePlaytimeSeconds: 10 }], 24, NOW);
    expect(plans[0]!.qualifiedBy).toBe("pvp-death");
  });

  it("does NOT plan a ban for an unqualified life (<300s, no kill, non-pvp death)", () => {
    const plans = planBans([{ ...base, effectivePlaytimeSeconds: 120 }], 24, NOW);
    expect(plans).toEqual([]);
  });

  it("uses BAN_DURATION_HOURS for expiry", () => {
    const plans = planBans([{ ...base, effectivePlaytimeSeconds: 400 }], 12, NOW);
    expect(plans[0]!.expiresAt.toISOString()).toBe("2026-07-12T00:00:00.000Z");
  });

  it("carries dayzId from the life onto the plan", () => {
    const life = {
      serverId: 1, gamertag: "Ronald", dayzId: "ABC123",
      startedAt: new Date("2026-07-20T00:00:00Z"),
      endedAt: new Date("2026-07-20T02:00:00Z"),
      deathCause: "pvp", effectivePlaytimeSeconds: 7200, playerKills: [],
    };
    expect(planBans([life], 24, NOW)[0]!.dayzId).toBe("ABC123");
  });

  it("carries a null dayzId through rather than dropping the ban", () => {
    const life = {
      serverId: 1, gamertag: "Ronald", dayzId: null,
      startedAt: new Date("2026-07-20T00:00:00Z"),
      endedAt: new Date("2026-07-20T02:00:00Z"),
      deathCause: "pvp", effectivePlaytimeSeconds: 7200, playerKills: [],
    };
    const plans = planBans([life], 24, NOW);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.dayzId).toBeNull();
  });
});

// A kill line naming the victim's own id (a player caught by his own explosive) used to be stored
// as `environment`; the parser now stores `explosion`. Neither word is `pvp`, so the ban decision
// for such a life must be exactly what it was — playtime or an earlier kill, never "pvp-death".
describe("planBans — the self-kill line", () => {
  const plan = (deathCause: string, over: Partial<EndedLife> = {}) =>
    planBans([{ ...base, deathCause, ...over }], 24, NOW);

  it("decisions are unchanged for the self-kill line", () => {
    const cases: Partial<EndedLife>[] = [
      { effectivePlaytimeSeconds: 120 },                                    // unqualified
      { effectivePlaytimeSeconds: 400 },                                    // playtime
      { effectivePlaytimeSeconds: 10, playerKills: [{ occurredAt: new Date("2026-07-11T11:00:00Z") }] }, // kill
    ];
    for (const over of cases) {
      expect(plan("explosion", over)).toEqual(plan("environment", over));
    }
    expect(plan("explosion", cases[0])).toEqual([]);
    expect(plan("explosion", cases[1])[0]!.qualifiedBy).toBe("playtime");
    expect(plan("explosion", cases[2])[0]!.qualifiedBy).toBe("kill");
  });

  it("a short life ended by one's own explosive is not a pvp death", () => {
    // Had the line been read as a player kill, this 10-second life would qualify on its own.
    expect(plan("pvp", { effectivePlaytimeSeconds: 10 })).toHaveLength(1);
    expect(plan("explosion", { effectivePlaytimeSeconds: 10 })).toEqual([]);
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

describe("banNames", () => {
  it("banNames lists the id first, then the gamertag", () => {
    expect(banNames({ dayzId: "ABC123", gamertag: "Ronald" })).toEqual(["ABC123", "Ronald"]);
  });

  it("banNames omits a null id rather than emitting a blank entry", () => {
    expect(banNames({ dayzId: null, gamertag: "Ronald" })).toEqual(["Ronald"]);
  });

  it("banNames omits an empty-string id", () => {
    expect(banNames({ dayzId: "", gamertag: "Ronald" })).toEqual(["Ronald"]);
  });

  it("banNames omits a whitespace-only id", () => {
    expect(banNames({ dayzId: "   ", gamertag: "Ronald" })).toEqual(["Ronald"]);
  });

  it("banNames trims a padded id", () => {
    expect(banNames({ dayzId: " ABC123 ", gamertag: "Ronald" })).toEqual(["ABC123", "Ronald"]);
  });
});

// ⚠️ BAN EFFECT of the two-second posthumous-kill grace (read-models kill-window.ts). A kill line
// stamped one or two seconds after the killer's own death counts toward the life that just ended.
// So a killer who died on a life under five minutes, to something that was not a player kill, is
// now banned for it "by kill". Before the grace that life was not qualified and drew no ban.
describe("planBans — a kill logged just after the killer's own death", () => {
  const started = new Date("2026-07-11T10:00:00Z");
  const died = new Date("2026-07-11T10:03:00Z");
  const short: EndedLife = {
    serverId: 1, gamertag: "Killer Two", dayzId: null, startedAt: started, endedAt: died,
    deathCause: "explosion", effectivePlaytimeSeconds: 180, playerKills: [],
  };
  const killAt = (iso: string) => ({ occurredAt: new Date(iso) });

  it("a short life with no kill is still not banned", () => {
    expect(planBans([short], 24, NOW)).toEqual([]);
  });

  it("bans the short life when its kill is logged one or two seconds after the death", () => {
    for (const iso of ["2026-07-11T10:03:01Z", "2026-07-11T10:03:02Z"]) {
      const plans = planBans([{ ...short, playerKills: [killAt(iso)] }], 24, NOW);
      expect(plans).toHaveLength(1);
      expect(plans[0]).toMatchObject({ qualifiedBy: "kill", lifeStartedAt: started, bannedAt: died });
      // The ban still runs from the death, not from the kill line.
      expect(plans[0]!.expiresAt.toISOString()).toBe("2026-07-12T10:03:00.000Z");
    }
  });

  it("does not ban it for a kill logged three seconds after the death", () => {
    expect(planBans([{ ...short, playerKills: [killAt("2026-07-11T10:03:03Z")] }], 24, NOW)).toEqual([]);
  });

  it("changes nothing for a life that qualified anyway", () => {
    const kill = [killAt("2026-07-11T10:03:01Z")];
    expect(planBans([{ ...short, deathCause: "pvp", playerKills: kill }], 24, NOW)[0]!.qualifiedBy).toBe("pvp-death");
    expect(planBans([{ ...short, effectivePlaytimeSeconds: 400 }], 24, NOW)[0]!.qualifiedBy).toBe("playtime");
    // Reported as "kill" now that the kill is inside the life; it was banned either way.
    expect(planBans([{ ...short, effectivePlaytimeSeconds: 400, playerKills: kill }], 24, NOW)[0]!.qualifiedBy).toBe("kill");
  });

  it("does not ban the killer's next short life for the previous life's posthumous kill", () => {
    const next: EndedLife = {
      ...short, startedAt: new Date("2026-07-11T10:03:01Z"), endedAt: new Date("2026-07-11T10:04:00Z"),
      effectivePlaytimeSeconds: 59, previousLifeEndedAt: died,
    };
    expect(planBans([{ ...next, playerKills: [killAt("2026-07-11T10:03:02Z")] }], 24, NOW)).toEqual([]);
    expect(planBans([{ ...next, playerKills: [killAt("2026-07-11T10:03:30Z")] }], 24, NOW)).toHaveLength(1);
  });
});

// A death can be found late: the enforcer was down, or a kill row that qualifies an old life
// only appeared later. A ban whose time is already up is not a ban. Recording it would put the
// player on the Nitrado list and take them straight off again, which also takes them off for
// any ban they are serving now, and would tell them they had been banned for a death long past.
describe("planBans — a death whose ban would already be over", () => {
  const life: EndedLife = { ...base, effectivePlaytimeSeconds: 400 }; // died 2026-07-11T12:00Z
  it("plans the ban while any of its time is left", () => {
    expect(planBans([life], 24, new Date("2026-07-12T11:59:59Z"))).toHaveLength(1);
  });
  it("plans nothing once the ban would have expired", () => {
    expect(planBans([life], 24, new Date("2026-07-12T12:00:00Z"))).toEqual([]); // same instant planExpiries calls due
    expect(planBans([life], 24, new Date("2026-07-21T12:00:00Z"))).toEqual([]);
  });
  it("uses the configured duration", () => {
    expect(planBans([life], 12, new Date("2026-07-12T00:00:00Z"))).toEqual([]);
    expect(planBans([life], 48, new Date("2026-07-12T12:00:00Z"))).toHaveLength(1);
  });
});

describe("namesToRelease", () => {
  const ban = (id: number, gamertag: string, dayzId: string | null, serverId = 1) => ({ id, serverId, gamertag, dayzId });
  it("releases the id and the gamertag when no other ban holds them", () => {
    const a = ban(1, "Ronald", "ABC123");
    expect(namesToRelease(a, [a, ban(2, "Other", "ZZZ999")])).toEqual(["ABC123", "Ronald"]);
  });
  it("releases nothing while the same player has another ban still running on that server", () => {
    const a = ban(1, "Ronald", "ABC123");
    expect(namesToRelease(a, [a, ban(2, "Ronald", "ABC123")])).toEqual([]);
  });
  it("after a rename, releases only the name the other ban does not hold", () => {
    const a = ban(1, "OldName", "ABC123");
    expect(namesToRelease(a, [a, ban(2, "NewName", "ABC123")])).toEqual(["OldName"]);
  });
  it("a ban on another server holds nothing here", () => {
    const a = ban(1, "Ronald", "ABC123");
    expect(namesToRelease(a, [a, ban(2, "Ronald", "ABC123", 2)])).toEqual(["ABC123", "Ronald"]);
  });
  it("a ban never holds its own names", () => {
    const a = ban(1, "Ronald", null);
    expect(namesToRelease(a, [a])).toEqual(["Ronald"]);
  });
});
