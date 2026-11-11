import { describe, it, expect } from "vitest";
import {
  buildDeathContext, isoSeconds, linesOfInput, selectContextLines, wholeCorpusContext,
  type ContextInput, type ServerCorpus,
} from "../src/index.js";
import { at, ID, logFile, OTHER, THIRD, VICTIM, who } from "./lines.js";

/**
 * Invented corpora. Server 1 writes its log at a fixed UTC-4. The death is always at 12:00:00 on
 * 2031-03-10 in file 30, at (1000, 2000), unless a test says otherwise.
 */
const V = (x = 1000, z = 2000) => who(VICTIM, at(x, z));
const D = (x = 1000, z = 2000) => who(VICTIM, at(x, z), true);
const STATS = "died. Stats> Water: 500 Energy: 500 Bleed sources: 0";
const FAR = at(9000, 9000);
const FOURTH = { name: "Fourth Four", id: ID("4") };
const corpus = (...files: ReturnType<typeof logFile>[]): ServerCorpus => ({ serverId: 1, map: "chernarusplus", files });
/** `file:line` of every selected line. */
const kept = (input: ContextInput): string[] => input.files.flatMap((f) => f.lines.map((l) => `${f.admFileId}:${l[0]}`));
/** The line index of the entry whose text contains `needle`, in a file built by `logFile`. */
const lineOf = (file: ReturnType<typeof logFile>, needle: string): number => {
  const hits = file.lines.filter((l) => l[1].includes(needle));
  if (hits.length !== 1) throw new Error(`test: "${needle}" matches ${hits.length} lines`);
  return hits[0]![0];
};
const seedOf = (file: ReturnType<typeof logFile>) => ({ admFileId: file.admFileId, lineIndex: lineOf(file, STATS) });

describe("selectContextLines", () => {
  it("a life that spans three files keeps all of the victim's lines", () => {
    const a = logFile(10, "2031-03-08", "09:00:00", [["09:00:05", `${V(100, 100)} is connected`], ["09:30:00", V(120, 100)], ["09:30:00", who(OTHER, FAR)]]);
    const b = logFile(20, "2031-03-09", "09:00:00", [["09:00:05", `${V(200, 100)} is connected`], ["10:00:00", `${V(220, 100)}[HP: 70] hit by Infected into Torso(0) for 30 damage (MeleeInfected)`]]);
    const c = logFile(30, "2031-03-10", "11:00:00", [["11:00:05", `${V()} is connected`], ["12:00:00", `${D()} ${STATS}`]]);
    const input = selectContextLines(corpus(c, a, b), seedOf(c));
    expect(input.files.map((f) => f.admFileId)).toEqual([10, 20, 30]);          // in the order they were written
    expect(kept(input)).toEqual(["10:2", "10:3", "20:2", "20:3", "30:2", "30:3"]);  // the far player two days earlier is not needed
    expect(input.deathRef).toEqual({ admFileId: 30, lineIndex: 3 });
    expect(input.prevDeaths).toEqual([]);
    const ctx = buildDeathContext(input);
    expect(ctx.life).toHaveLength(5);
    expect(ctx.hits).toHaveLength(1);
    expect(isoSeconds(ctx.t0)).toBe("2031-03-10T16:00:00Z");
    // the times were stamped from the whole files and are carried, not recomputed
    expect(linesOfInput(input).map((l) => isoSeconds(l.ts))[0]).toBe("2031-03-08T13:00:05Z");
  });

  it("server lines 601 s before are dropped", () => {
    const f = logFile(30, "2031-03-10", "11:00:00", [
      ["11:49:59", `${who(OTHER, FAR)} is connected`], ["11:50:00", who(OTHER, FAR)], ["11:55:00", "##### PlayerList log: 2 players"],
      ["12:00:00", `${D()} ${STATS}`], ["12:05:00", who(THIRD, FAR)], ["12:05:01", who(FOURTH, FAR)],
    ]);
    const input = selectContextLines(corpus(f), seedOf(f));
    // 600 s before to 300 s after, whoever the line is about and however far away — and lines about nobody too
    expect(kept(input)).toEqual(["30:3", "30:4", "30:5", "30:6"]);
  });

  it("another player 19 m from the victim 40 minutes before death is kept", () => {
    const f = logFile(30, "2031-03-10", "11:00:00", [
      ["11:20:00", V(500, 500)],
      ["11:20:00", who(OTHER, at(519, 500))],          // 19 m, same second: company
      ["11:20:00", who(THIRD, at(521, 500))],          // 21 m: not
      ["11:21:00", who(FOURTH, at(510, 500))],         // 60 s later: still company
      ["11:21:01", who({ name: "Fifth Five", id: ID("5") }, at(510, 500))],   // 61 s: not
      ["11:40:00", V(800, 800)],
      ["12:00:00", `${D()} ${STATS}`],
    ]);
    const input = selectContextLines(corpus(f), seedOf(f));
    expect(kept(input)).toEqual(["30:2", "30:3", "30:5", "30:7", "30:8"]);
  });

  it("a line that names the victim as the attacker is kept for twenty minutes back", () => {
    const hit = (name: string) => `${who(OTHER, FAR)}[HP: 50] hit by ${V(8990, 9000)} into Torso(0) for 30 damage (MeleeFist) ${name}`;
    const f = logFile(30, "2031-03-10", "11:00:00", [["11:39:59", hit("early")], ["11:40:00", hit("inside")], ["12:00:00", `${D()} ${STATS}`]]);
    expect(kept(selectContextLines(corpus(f), seedOf(f)))).toEqual(["30:3", "30:4"]);
  });

  it("a placement 29 m from an earlier damaging hit is kept", () => {
    const old = logFile(10, "2031-02-01", "09:00:00", [
      ["09:10:00", `${who(OTHER, at(5029, 5000))} placed Bear Trap<BearTrap>`],
      ["09:11:00", `${who(THIRD, at(5031, 5000))} placed Bear Trap<BearTrap>`],
      ["09:12:00", `${who(THIRD, at(1029, 2000))} placed Fireplace<Fireplace>`],
    ]);
    const f = logFile(30, "2031-03-10", "10:00:00", [
      ["10:00:05", `${V(5000, 5000)} is connected`],
      ["10:30:00", `${V(5000, 5000)}[HP: 60] hit by BearTrap into LeftLeg(0) for 40 damage (BearTrapHit)`],
      ["12:00:00", `${D()} ${STATS}`],
    ]);
    const input = selectContextLines(corpus(old, f), seedOf(f));
    // five weeks old: near the hit (29 m, not 31 m), and near the death itself
    expect(kept(input)).toEqual(["10:2", "10:4", "30:2", "30:3", "30:4"]);
    expect(input.placements).toEqual([{ admFileId: 10, lineIndex: 2 }, { admFileId: 10, lineIndex: 4 }]);
    const ctx = buildDeathContext(input);
    expect(ctx.server.placedNear([5000, 5000, 10], new Set(["BearTrap"]), 30, ctx.firstSeq).map((p) => p.line.subject!.id)).toEqual([OTHER.id]);
  });

  const TRIP = "hit by TripwireTrap into (0) for 0 damage (TripWireHit)";
  const tripDeath: [string, string][] = [
    ["11:59:56", `${V()}[HP: 100] ${TRIP}`],
    ["12:00:00", `${D()}[HP: 0] hit by explosion (M67Grenade_Ammo)`],
    ["12:00:00", `${D()} killed by 6-M7 Frag Grenade`],
  ];

  it("a neighbour's tripwire 12 m from the anchor and the trip that spent it are kept", () => {
    const old = logFile(10, "2031-02-01", "09:00:00", [
      ["09:10:00", `${who(OTHER, at(1002, 2000))} placed Tripwire<TripwireTrap>`],          // the candidate, 2 m
      ["09:20:00", `${who(THIRD, at(1012, 2000))} placed Tripwire<TripwireTrap>`],          // the neighbour, 12 m
      ["09:25:00", `${who(THIRD, at(1016, 2000))} placed Tripwire<TripwireTrap>`],          // 16 m: outside the ring
      ["09:30:00", `${who(THIRD, at(1012, 2000))} placed Land Mine<LandMineTrap>`],          // another kind of device
    ]);
    const mid = logFile(20, "2031-02-20", "09:00:00", [
      ["09:10:00", `${who(FOURTH, at(1015, 2000))}[HP: 100] ${TRIP}`],                        // 3 m from the neighbour's wire: it is spent
      ["09:20:00", `${who(FOURTH, at(1018.5, 2000))}[HP: 100] ${TRIP}`],                      // 6.5 m from it: some other wire
      ["09:30:00", `${who(FOURTH, at(1015, 2000))}[HP: 50] hit by explosion (M67Grenade_Ammo)`],   // not a trip line
    ]);
    const f = logFile(30, "2031-03-10", "11:55:00", tripDeath);
    const input = selectContextLines(corpus(old, mid, f), seedOf2(f));
    expect(kept(input)).toEqual(["10:2", "10:3", "10:4", "10:5", "20:2", "30:2", "30:3", "30:4"]);
    // 10:4 and 10:5 are kept by the ordinary placement rule (within 30 m of the death); the trip in file 20 only by the ring
    expect(input.placements).toHaveLength(4);
  });

  it("a detonation at the anchor months before the death is kept when a candidate placement is older", () => {
    const old = logFile(10, "2030-11-01", "09:00:00", [
      ["09:05:00", `${who(FOURTH, at(1001, 2000))}[HP: 100] ${TRIP}`],                        // before any placement: some earlier wire
      ["09:10:00", `${who(OTHER, at(1002, 2000))} placed Tripwire<TripwireTrap>`],
    ]);
    const mid = logFile(20, "2030-12-15", "09:00:00", [["09:10:00", `${who(FOURTH, at(1001, 2000))}[HP: 100] ${TRIP}`]]);
    const f = logFile(30, "2031-03-10", "11:55:00", tripDeath);
    const input = selectContextLines(corpus(old, mid, f), seedOf2(f));
    expect(kept(input)).toEqual(["10:3", "20:2", "30:2", "30:3", "30:4"]);
  });

  it("a land mine death has its own ring: mines and mine blasts, in both spellings", () => {
    const old = logFile(10, "2031-01-01", "09:00:00", [
      ["09:10:00", `${who(OTHER, at(1001, 2000))} placed Land Mine<LandMineTrap>`],
      ["09:20:00", `${who(FOURTH, at(1001, 2000))}[HP: 100] ${TRIP}`],                        // a tripwire's line: not a mine going off
    ]);
    const mid = logFile(20, "2031-02-01", "09:00:00", [
      ["09:10:00", `${who(FOURTH, at(1003, 2000))}[HP: 20] hit by explosion (LandMineExplosion_Ammo)`],
      ["09:20:00", `${who(FOURTH, at(1003, 2000))}[HP: 20] hit by explosion (LandMineExplosion)`],
    ]);
    const f = logFile(30, "2031-03-10", "11:55:00", [["12:00:00", `${D()} killed by LandMineTrap`]]);
    const input = selectContextLines(corpus(old, mid, f), { admFileId: 30, lineIndex: 2 });
    expect(kept(input)).toEqual(["10:2", "20:2", "20:3", "30:2"]);
  });

  it("a death that is not by trap gets no ring", () => {
    const old = logFile(10, "2031-02-01", "09:00:00", [["09:10:00", `${who(OTHER, at(1002, 2000))} placed Tripwire<TripwireTrap>`]]);
    const mid = logFile(20, "2031-02-20", "09:00:00", [["09:10:00", `${who(FOURTH, at(1001, 2000))}[HP: 100] ${TRIP}`]]);
    const f = logFile(30, "2031-03-10", "11:55:00", [["12:00:00", `${D()} ${STATS}`]]);
    expect(kept(selectContextLines(corpus(old, mid, f), seedOf(f)))).toEqual(["10:2", "30:2"]);
  });

  it("the previous cluster bounds the life", () => {
    const old = logFile(10, "2031-03-08", "09:00:00", [
      ["09:00:05", `${V(100, 100)} is connected`],
      ["09:10:00", `${V(100, 100)}[HP: 5] hit by Infected into Torso(0) for 30 damage (MeleeInfected)`],
      ["09:20:00", `${D(100, 100)} ${STATS}`], ["09:20:01", `${D(100, 100)} bled out`],
      ["09:20:30", `${D(100, 100)} is choosing to respawn`],
      ["09:21:00", `${V(300, 300)} is connected`],
    ]);
    const f = logFile(30, "2031-03-10", "11:00:00", [["11:00:05", `${V()} is connected`], ["12:00:00", `${D()} ${STATS}`]]);
    const input = selectContextLines(corpus(old, f), seedOf(f));
    // the previous death's own lines are kept so the cluster resolves the same way; nothing before them is
    expect(kept(input)).toEqual(["10:4", "10:5", "10:6", "10:7", "30:2", "30:3"]);
    expect(input.prevDeaths).toEqual([{ ts: Date.UTC(2031, 2, 8, 13, 20, 0) / 1000, pos: [100, 100, 10] }]);
    const ctx = buildDeathContext(input);
    expect(ctx.life.map((l) => `${l.admFileId}:${l.lineIndex}`)).toEqual(["10:6", "10:7", "30:2"]);   // after the bled-out line
    expect(ctx.hits).toEqual([]);                                 // the hit of the life before is not this life's
    expect(ctx.fresh).toBe(true);
    // and the earlier death selects only itself
    expect(selectContextLines(corpus(old, f), { admFileId: 10, lineIndex: 5 }).deathRef).toEqual({ admFileId: 10, lineIndex: 4 });
  });

  it("any line of the death is a valid seed, and a line that is no death is refused", () => {
    const f = logFile(30, "2031-03-10", "11:00:00", [["11:59:59", `${V()} committed suicide`], ["12:00:00", `${D()} ${STATS}`], ["12:00:00", `${D()} committed suicide`]]);
    const want = selectContextLines(corpus(f), { admFileId: 30, lineIndex: 3 });
    expect(want.cluster.lines.map((l) => l.role)).toEqual(["suicide_before", "primary", "suicide_after"]);
    expect(selectContextLines(corpus(f), { admFileId: 30, lineIndex: 2 })).toEqual(want);
    expect(selectContextLines(corpus(f), { admFileId: 30, lineIndex: 4 })).toEqual(want);
    expect(() => selectContextLines(corpus(f), { admFileId: 30, lineIndex: 0 })).toThrow();
    expect(() => selectContextLines(corpus(f), { admFileId: 99, lineIndex: 0 })).toThrow(/not in the corpus/);
  });

  it("an old placement from a file outside the corpus is tested like any other line", () => {
    const f = logFile(30, "2031-03-10", "11:55:00", tripDeath);
    const name = "DayZServer_X1_x64_2031-01-05_08-00-00.ADM";
    const extra = [
      { admFileId: 5, fileName: name, lineIndex: 40, text: `09:10:00 | ${who(OTHER, at(1002, 2000))} placed Tripwire<TripwireTrap>` },
      { admFileId: 5, fileName: name, lineIndex: 50, text: `09:20:00 | ${who(THIRD, at(4000, 4000))} placed Tripwire<TripwireTrap>` },   // nowhere near
      { admFileId: 30, fileName: f.name, lineIndex: 2, text: f.lines[2]![1] },                                                             // already in the corpus
    ];
    const input = selectContextLines(corpus(f), seedOf2(f), extra);
    // (30:0 and 30:1 are the file's banner and header: they carry no clock, take the file's start
    // time, and that is inside the server window here)
    expect(kept(input)).toEqual(["5:40", "30:0", "30:1", "30:2", "30:3", "30:4"]);
    expect(input.files[0]).toMatchObject({ admFileId: 5, name });
    expect(isoSeconds(input.files[0]!.lines[0]![1])).toBe("2031-01-05T13:10:00Z");
    const ctx = buildDeathContext(input);
    expect(ctx.server.placedNear(ctx.pos!, new Set(["TripwireTrap"]), 5, ctx.firstSeq).map((p) => p.line.subject!.id)).toEqual([OTHER.id]);
  });

  it("the selection and the whole corpus give the same context", () => {
    const noise: [string, string][] = Array.from({ length: 50 }, (_, i) => [`09:${String(i).padStart(2, "0")}:00`, who(THIRD, at(7000 + i, 7000))] as [string, string]);
    const old = logFile(10, "2031-03-09", "09:00:00", noise);
    const f = logFile(30, "2031-03-10", "11:00:00", [
      ["11:00:05", `${V()} is connected`],
      ["11:59:00", `${V()}[HP: 40] hit by ${who(OTHER, at(1005, 2000))} into Torso(0) for 60 damage (Bullet_556x45) with M4-A1 from 5 meters`],
      ["12:00:00", `${D()}[HP: 0] hit by ${who(OTHER, at(1005, 2000))} into Head(0) for 90 damage (Bullet_556x45) with M4-A1 from 5 meters`],
      ["12:00:00", `${D()} killed by ${who(OTHER, at(1005, 2000))} with M4-A1 from 5 meters`],
    ]);
    const c = corpus(old, f), seed = { admFileId: 30, lineIndex: 5 };
    const trimmed = buildDeathContext(selectContextLines(c, seed)), whole = wholeCorpusContext(c, seed);
    expect(trimmed.server.lines.length).toBe(4);
    expect(whole.server.lines.length).toBe(58);
    const facts = (x: typeof whole) => ({
      t0: x.t0, pos: x.pos, shape: [...x.shape], killer: x.killer, hits: x.hits.map((h) => [h.hp, h.cat, h.pid]),
      fatal: x.fatal.map((h) => h.o.lineIndex), near: [...x.server.othersNear(x.pid, x.pos!, x.t0 - 120, x.t0, 50)],
    });
    expect(facts(trimmed)).toEqual(facts(whole));
    expect(facts(trimmed).killer).toMatchObject({ id: OTHER.id, kind: "player" });
  });
});

/** The seed of a trap death built from `tripDeath`: its kill line. */
function seedOf2(file: ReturnType<typeof logFile>) {
  return { admFileId: file.admFileId, lineIndex: lineOf(file, "killed by 6-M7 Frag Grenade") };
}
