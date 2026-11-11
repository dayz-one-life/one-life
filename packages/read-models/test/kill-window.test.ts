import { describe, it, expect } from "vitest";
import { POSTHUMOUS_KILL_GRACE_MS, isKillInLife, killWindowEnd, previousLifeEnd } from "../src/kill-window.js";

const T = (iso: string) => new Date(iso);
const start = T("2026-07-11T10:00:00Z");
const died = T("2026-07-11T10:03:00Z");
const life = { startedAt: start, endedAt: died };

describe("the posthumous-kill grace", () => {
  it("is two seconds", () => {
    expect(POSTHUMOUS_KILL_GRACE_MS).toBe(2000);
    expect(killWindowEnd(died)).toEqual(T("2026-07-11T10:03:02Z"));
  });

  it("a kill inside the life counts, as before", () => {
    expect(isKillInLife(start, life)).toBe(true);
    expect(isKillInLife(T("2026-07-11T10:01:00Z"), life)).toBe(true);
    expect(isKillInLife(died, life)).toBe(true);
    expect(isKillInLife(T("2026-07-11T09:59:59Z"), life)).toBe(false);
  });

  it("a kill logged one or two seconds after the killer's death counts toward the life that ended", () => {
    expect(isKillInLife(T("2026-07-11T10:03:01Z"), life)).toBe(true);
    expect(isKillInLife(T("2026-07-11T10:03:02Z"), life)).toBe(true);
  });

  it("a kill logged later than two seconds after the death does not", () => {
    expect(isKillInLife(T("2026-07-11T10:03:02.001Z"), life)).toBe(false);
    expect(isKillInLife(T("2026-07-11T10:03:03Z"), life)).toBe(false);
  });

  it("an open life has no upper bound", () => {
    expect(isKillInLife(T("2026-07-12T10:00:00Z"), { startedAt: start, endedAt: null })).toBe(true);
  });

  // The killer died at 10:03:00 and was back at 10:03:01. The kill stamped 10:03:01 or 10:03:02
  // was made by the character that died: it belongs to the old life and must not also land in
  // the new one, where it would qualify a life that never fired a shot.
  describe("when the killer respawned inside the grace", () => {
    const next = { startedAt: T("2026-07-11T10:03:01Z"), endedAt: null, previousLifeEndedAt: died };

    it("the kill stays with the life that ended", () => {
      expect(isKillInLife(T("2026-07-11T10:03:01Z"), life)).toBe(true);
      expect(isKillInLife(T("2026-07-11T10:03:02Z"), life)).toBe(true);
    });

    it("and is not counted toward the new life", () => {
      expect(isKillInLife(T("2026-07-11T10:03:01Z"), next)).toBe(false);
      expect(isKillInLife(T("2026-07-11T10:03:02Z"), next)).toBe(false);
    });

    it("the new life counts kills from the first instant after the grace", () => {
      expect(isKillInLife(T("2026-07-11T10:03:02.001Z"), next)).toBe(true);
      expect(isKillInLife(T("2026-07-11T10:03:03Z"), next)).toBe(true);
    });

    it("a new life that began in the same second as the death does not share that second's kill", () => {
      const sameSecond = { startedAt: died, endedAt: null, previousLifeEndedAt: died };
      expect(isKillInLife(died, life)).toBe(true);
      expect(isKillInLife(died, sameSecond)).toBe(false);
    });
  });

  it("a previous life that ended long before changes nothing", () => {
    const next = { startedAt: T("2026-07-11T11:00:00Z"), endedAt: null, previousLifeEndedAt: died };
    expect(isKillInLife(T("2026-07-11T11:00:00Z"), next)).toBe(true);
  });
});

describe("previousLifeEnd", () => {
  const first = { startedAt: T("2026-07-10T07:00:00Z"), endedAt: T("2026-07-10T08:00:00Z") };
  const second = { startedAt: start, endedAt: died };
  const third = { startedAt: T("2026-07-11T10:03:01Z"), endedAt: null };
  const all = [second, third, first];

  it("is the end of the life that started before this one", () => {
    expect(previousLifeEnd(all, third.startedAt)).toEqual(died);
    expect(previousLifeEnd(all, second.startedAt)).toEqual(first.endedAt);
  });
  it("is null for a first life", () => {
    expect(previousLifeEnd(all, first.startedAt)).toBeNull();
    expect(previousLifeEnd([], start)).toBeNull();
  });
  it("a life that began and ended in the same second is not its own predecessor", () => {
    const instant = { startedAt: died, endedAt: died };
    expect(previousLifeEnd([instant], instant.startedAt)).toBeNull();
    expect(isKillInLife(T("2026-07-11T10:03:01Z"), { ...instant, previousLifeEndedAt: previousLifeEnd([instant], instant.startedAt) })).toBe(true);
  });
});
