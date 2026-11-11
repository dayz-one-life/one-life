import { describe, it, expect } from "vitest";
import { allClusters, buildRecord, previousClusterEnd, resolveCluster, type DeathCluster } from "../src/index.js";
import { at, OTHER, ref, stamped, VICTIM, who } from "./lines.js";

const V = who(VICTIM), D = who(VICTIM, at(1000, 2000), true);
const STATS = "died. Stats> Water: 500 Energy: 500 Bleed sources: 0";
const roles = (c: DeathCluster) => c.lines.map((l) => `${l.ref.lineIndex}:${l.role}`);

describe("resolveCluster", () => {
  it("suicide then died one second later resolves to the died line from either seed", () => {
    const lines = stamped([[0, `${V} committed suicide`], [1, `${D} ${STATS}`]]);
    const fromSuicide = resolveCluster(lines, ref(0)), fromDied = resolveCluster(lines, ref(1));
    expect(fromSuicide).toEqual(fromDied);
    expect(fromDied.primary).toEqual(ref(1));
    expect(roles(fromDied)).toEqual(["0:suicide_before", "1:primary"]);
  });

  it("a committed suicide line is never the primary, in the blade order either", () => {
    const lines = stamped([[0, `${D} ${STATS}`], [0, `${D} committed suicide`]]);
    expect(resolveCluster(lines, ref(1)).primary).toEqual(ref(0));
    expect(roles(resolveCluster(lines, ref(1)))).toEqual(["0:primary", "1:suicide_after"]);
  });

  it("a marker 119 s before is in the cluster and one 121 s before is not", () => {
    const inside = stamped([[-119, `${V} is disconnecting while being unconscious`], [0, `${D} ${STATS}`]]);
    expect(roles(resolveCluster(inside, ref(1)))).toEqual(["0:disconnect_uncon", "1:primary"]);
    const outside = stamped([[-121, `${V} is disconnecting while being unconscious`], [0, `${D} ${STATS}`]]);
    expect(roles(resolveCluster(outside, ref(1)))).toEqual(["1:primary"]);
    expect(() => resolveCluster(outside, ref(0))).toThrow(/not part of a death/);
  });

  it("the restrained marker has its own role", () => {
    const lines = stamped([[-5, `${V} is disconnecting while being restrained`], [0, `${D} ${STATS}`]]);
    expect(roles(resolveCluster(lines, ref(0)))).toEqual(["0:disconnect_restrained", "1:primary"]);
  });

  it("a connect between two death lines splits them", () => {
    const lines = stamped([[0, `${D} ${STATS}`], [5, `${V} is connected`], [10, `${D} ${STATS}`]]);
    expect(allClusters(lines).map(roles)).toEqual([["0:primary"], ["2:primary"]]);
    // without the connect, the second line within 30 s belongs to the first death
    const joined = stamped([[0, `${D} ${STATS}`], [10, `${D} ${STATS}`]]);
    expect(allClusters(joined).map(roles)).toEqual([["0:primary", "1:primary_extra"]]);
  });

  it("a second death line, a bled out and a dead-form suicide join at 30 s and do not at 31 s", () => {
    const after = (dt: number, rest: string) => stamped([[0, `${D} ${STATS}`], [dt, `${D} ${rest}`]]);
    expect(allClusters(after(30, STATS)).map(roles)).toEqual([["0:primary", "1:primary_extra"]]);
    expect(allClusters(after(31, STATS)).map(roles)).toEqual([["0:primary"], ["1:primary"]]);
    expect(allClusters(after(30, "bled out")).map(roles)).toEqual([["0:primary", "1:bled_out"]]);
    expect(allClusters(after(31, "bled out")).map(roles)).toEqual([["0:primary"]]);
    expect(() => resolveCluster(after(31, "bled out"), ref(1))).toThrow(/not part of a death/);
    expect(allClusters(after(30, "committed suicide")).map(roles)).toEqual([["0:primary", "1:suicide_after"]]);
    expect(allClusters(after(31, "committed suicide")).map(roles)).toEqual([["0:primary"]]);
  });

  it("a connect between a marker and a death line drops the marker", () => {
    const lines = stamped([[-20, `${V} committed suicide`], [-10, `${V} is connected`], [0, `${D} ${STATS}`]]);
    expect(roles(resolveCluster(lines, ref(2)))).toEqual(["2:primary"]);
  });

  it("four identical kill lines give one primary and three primary_extra", () => {
    const kill = `${D} killed by ${who(OTHER, at(1010, 2000))} with M4-A1 from 10 meters`;
    const lines = stamped([[0, kill], [0, kill], [0, kill], [0, kill]]);
    const c = resolveCluster(lines, ref(2));
    expect(roles(c)).toEqual(["0:primary", "1:primary_extra", "2:primary_extra", "3:primary_extra"]);
    expect(buildRecord(c, lines, lines).nKillLines).toBe(4);
    expect(buildRecord(c, lines, lines).shape).toContain("multi_kill_lines");
  });

  it("a killed-by line is preferred as the primary over a died line written first", () => {
    const lines = stamped([[0, `${D} ${STATS}`], [0, `${D} killed by ${who(OTHER)} with M4-A1 from 10 meters`]]);
    const c = resolveCluster(lines, ref(0));
    expect(c.primary).toEqual(ref(1));
    expect(buildRecord(c, lines, lines).killer?.id).toBe(OTHER.id);
  });

  it("respawn_dead is excluded and does not end the previous cluster", () => {
    const lines = stamped([
      [0, `${D} ${STATS}`], [1, `${D} bled out`], [40, `${D} is choosing to respawn`],
      [60, `${V} is connected`], [70, V], [500, `${D} ${STATS}`],
    ]);
    const first = resolveCluster(lines, ref(0)), second = resolveCluster(lines, ref(5));
    expect(roles(first)).toEqual(["0:primary", "1:bled_out"]);
    expect(() => resolveCluster(lines, ref(2))).toThrow(/not part of a death/);
    // the life that ended in the second death starts after the bled-out line, not after the respawn line
    expect(previousClusterEnd(lines, second)).toBe(1);
    expect(previousClusterEnd(lines, first)).toBeNull();
  });

  it("the alive-form respawn is a marker of the death that follows", () => {
    const lines = stamped([[-3, `${V} is unconscious`], [-1, `${V} is choosing to respawn`], [0, `${D} ${STATS}`]]);
    const c = resolveCluster(lines, ref(1));
    expect(roles(c)).toEqual(["1:respawn_alive", "2:primary"]);
    expect(buildRecord(c, lines, lines).shape).toEqual(["died", "respawn_alive_form"]);
  });

  it("another player's lines never join the victim's cluster", () => {
    const lines = stamped([[0, `${who(OTHER)} committed suicide`], [1, `${D} ${STATS}`]]);
    const own = lines.filter((l) => l.subject!.id === VICTIM.id);
    expect(roles(resolveCluster(own, ref(1)))).toEqual(["1:primary"]);
  });
});

describe("buildRecord", () => {
  it("takes the death position from the death line, else from the victim's last line before it", () => {
    const lines = stamped([[-10, who(VICTIM, at(900, 900))], [0, `Player "${VICTIM.name}" (DEAD) (id=${VICTIM.id}) ${STATS}`]]);
    const r = buildRecord(resolveCluster(lines, ref(1)), lines, lines);
    expect(r.pos).toEqual([900, 900, 10]);
    expect(r.posSource).toBe("last_valid_before_death");
    expect(r.stats).toEqual({ water: 500, energy: 500, bleedSources: 0 });
  });

  it("finds a co-death and a co-knock-out within 2 s and 15 m, and nothing further off", () => {
    const lines = stamped([
      [0, `${D} ${STATS}`],
      [1, `${who(OTHER, at(1005, 2000), true)} ${STATS}`],
      [1, `${who({ name: "Third Three", id: "3".repeat(40) }, at(1010, 2000))} is unconscious`],
      [1, `${who({ name: "Far Four", id: "4".repeat(40) }, at(1020, 2000))} is unconscious`],
      [3, `${who({ name: "Late Five", id: "5".repeat(40) }, at(1001, 2000), true)} ${STATS}`],
    ]);
    const own = lines.filter((l) => l.subject!.id === VICTIM.id);
    const f = buildRecord(resolveCluster(own, ref(0)), own, lines).features;
    expect(f.coDeaths.map((c) => [c.victimId, c.dtS, c.distM])).toEqual([[OTHER.id, 1, 5]]);
    expect(f.coKnockouts.map((c) => [c.id, c.distM])).toEqual([["3".repeat(40), 10]]);
  });

  it("measures how far the body was logged from where it died", () => {
    const lines = stamped([[0, `${D} ${STATS}`], [20, `${who(VICTIM, at(1008, 2000), true)}`], [25, `${who(VICTIM, at(1003, 2000))} has been disconnected`]]);
    const f = buildRecord(resolveCluster(lines, ref(0)), lines, lines).features;
    expect(f.corpseDrift30sM).toBe(8);
    expect(f.corpseDriftDtS).toBe(20);
  });

  it("tags an explosive context from the kill line or from a blast in the last 30 s", () => {
    const mine = stamped([[0, `${D} killed by LandMineTrap`]]);
    expect(buildRecord(resolveCluster(mine, ref(0)), mine, mine).shape).toEqual(["killed_by:explosive", "explosive_or_trap_context"]);
    const blast = stamped([[-10, `${V}[HP: 40] hit by explosion (M67Grenade_Ammo)`], [0, `${D} ${STATS}`]]);
    expect(buildRecord(resolveCluster(blast, ref(1)), blast, blast).shape).toEqual(["died", "explosive_or_trap_context"]);
  });
});
