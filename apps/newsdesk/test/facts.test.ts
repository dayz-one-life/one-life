import { describe, it, expect } from "vitest";
import { timeAliveLabel, storedFacts } from "../src/facts.js";
import { factsFor } from "./facts-fixture.js";

const credit = { gamertag: "Placer Person", device: "tripwire" as const, byOperator: false };
const trapVerdict = { cause: "explosive_trap" as const, objectKey: "m67_grenade" as const, attrBasis: "placement" as const };

describe("timeAliveLabel", () => {
  it("uses days over 24h, else h/m", () => {
    expect(timeAliveLabel(7200)).toBe("2h 0m");
    expect(timeAliveLabel(90000)).toBe("1d 1h");
    expect(timeAliveLabel(90)).toBe("1m");
  });
});

describe("buildObituaryFacts", () => {
  it("derives kills, longest kill, sessions, the death and its tag from the stored verdict", () => {
    const f = factsFor({
      verdict: { cause: "pvp", attrBasis: "kill_line" },
      life: { deathCause: "pvp", deathByGamertag: "Killer Two", deathWeapon: "M4", deathDistance: 120 },
      kills: [{ distanceMeters: 120 }, { distanceMeters: 300 }, { distanceMeters: null }],
    });
    expect(f.kills).toBe(3);
    expect(f.trapKills).toBe(0);
    expect(f.longestKillMeters).toBe(300);
    expect(f.sessions).toBe(2);
    expect(f.causeCategory).toBe("PvP");
    expect(f.killerGamertag).toBe("Killer Two");
    expect(f.death).toMatchObject({ key: "pvp", tag: "PvP", certainty: "definitive", label: "Killed by Killer Two" });
    expect(f.verdict).toEqual({ cause: "pvp", confidence: "high", conditions: [] });
    expect(f.endedAt).toBe("2031-07-10T02:00:00.000Z");
  });

  it("causeCategory is the family tag; Unknown only for not recorded or withheld", () => {
    expect(factsFor({ verdict: { cause: "starvation", confidence: "inferred" } }).causeCategory).toBe("Hunger and Thirst");
    expect(factsFor({ verdict: { cause: "suicide" }, life: { deathCause: "suicide" } }).causeCategory).toBe("Self-Inflicted");
    expect(factsFor({ verdict: { cause: "unknown", confidence: "unknown" } }).causeCategory).toBe("Unknown");
    expect(factsFor({ verdict: { cause: "restrained_logout" } }).causeCategory).toBe("Unknown");
  });

  it("a named driver is not the killer and is nowhere in the facts", () => {
    const f = factsFor({
      verdict: { cause: "vehicle_run_over", attrBasis: "kill_line_driver" },
      life: { deathCause: "pvp", deathByGamertag: "Driver Seven", deathWeapon: "Sedan" },
    });
    expect(f.killerGamertag).toBeNull();
    expect(JSON.stringify(f)).not.toContain("Driver Seven");
  });

  it("flags a legend by kills, and kills and isLegend count a trap kill", () => {
    const kills = [...Array.from({ length: 19 }, () => ({ distanceMeters: 10 })), { distanceMeters: null, basis: "trap_placement" as const }];
    const f = factsFor({ kills });
    expect(f.kills).toBe(20);
    expect(f.trapKills).toBe(1);
    expect(f.isLegend).toBe(true);
  });

  it("flags a fresh-spawn victim only for a stated player kill", () => {
    const pvp = factsFor({ verdict: { cause: "pvp", attrBasis: "kill_line" }, life: { deathCause: "pvp", deathByGamertag: "Camper", playtimeSeconds: 600 } });
    expect(pvp.freshSpawnVictim).toBe(true);
    expect(pvp.isLegend).toBe(false);
    const inferred = factsFor({ verdict: { cause: "pvp", confidence: "inferred", mechanismStated: false }, life: { playtimeSeconds: 600 } });
    expect(inferred.death.certainty).toBe("inferred");
    expect(inferred.freshSpawnVictim).toBe(false);
    const suicide = factsFor({ verdict: { cause: "suicide" }, life: { deathCause: "suicide", playtimeSeconds: 15 } });
    expect(suicide.freshSpawnVictim).toBe(false);
  });

  it("carries ordeals, hpLow, deathDistance and priors", () => {
    const f = factsFor({
      verdict: { cause: "pvp", attrBasis: "kill_line" },
      life: { deathCause: "pvp", deathByGamertag: "Camper", deathWeapon: "SKS", deathDistance: 153.4 },
      ordeals: { infected: { encounters: 2, hits: 3, worstEncounterHits: 2 } },
      hpLow: 12,
      priors: { livesLived: 2, totalKills: 4, trapKills: 1 },
    });
    expect(f.ordeals!.infected.encounters).toBe(2);
    expect(f.hpLow).toBe(12);
    expect(f.deathDistance).toBe(153.4);
    expect(f.priors.trapKills).toBe(1);
    expect(f.isKnownQuantity).toBe(true);
  });
});

describe("what is stored", () => {
  it("no gamertag other than a kill-line killer appears anywhere in the stored facts", () => {
    const f = factsFor({ verdict: trapVerdict, life: { deathCause: "explosion" }, credit });
    expect(f.creditedGamertag).toBe("Placer Person");
    expect(f.brief.creditLine).toContain("Placer Person");
    const s = JSON.stringify(storedFacts(f));
    expect(s).not.toContain("Placer Person");
    expect(s).not.toContain("creditedGamertag");
    expect(s).not.toContain("brief");
  });

  it("creditSent is stored as a boolean", () => {
    expect(storedFacts(factsFor({ verdict: trapVerdict, life: { deathCause: "explosion" }, credit })).creditSent).toBe(true);
    expect(storedFacts(factsFor({ verdict: trapVerdict, life: { deathCause: "explosion" } })).creditSent).toBe(false);
    // A credit for the wrong device is not shown, so it is not sent either.
    const mine = factsFor({ verdict: trapVerdict, life: { deathCause: "explosion" }, credit: { ...credit, device: "land_mine" } });
    expect(mine.creditSent).toBe(false);
    expect(mine.creditedGamertag).toBeNull();
  });

  it("trapKills and priors.trapKills are stored as numbers", () => {
    const s = storedFacts(factsFor({ kills: [{ distanceMeters: null, basis: "trap_placement" }], priors: { livesLived: 1, totalKills: 3, trapKills: 2 } }));
    expect(s.trapKills).toBe(1);
    expect(s.priors.trapKills).toBe(2);
    expect(typeof s.trapKills).toBe("number");
  });

  it("a trap kill in an earlier life is in priors.trapKills and not in trapKills", () => {
    const f = factsFor({ kills: [{ distanceMeters: 50 }], priors: { livesLived: 1, totalKills: 1, trapKills: 1 } });
    expect(f.trapKills).toBe(0);
    expect(f.priors.trapKills).toBe(1);
  });

  it("facts hold no logout flag or token", () => {
    const f = factsFor({ verdict: { cause: "unconscious_logout", upstream: { cause: "infected", confidence: "definitive" } } });
    expect(f.death.key).toBe("infected");
    const s = JSON.stringify(f).toLowerCase();
    for (const w of ["logout", "log out", "logged", "unconscious", "respawn", "disconnect"]) expect(s).not.toContain(w);
  });

  it("the stored verdict is today's vocabulary, never a logout token or 'high' for an inferred cause", () => {
    expect(factsFor({ verdict: { cause: "cold_exposure", confidence: "inferred" } }).verdict).toEqual({ cause: "unknown", confidence: "low", conditions: [] });
    expect(factsFor({ verdict: { cause: "starvation", confidence: "inferred" } }).verdict.confidence).toBe("low");
  });
});
