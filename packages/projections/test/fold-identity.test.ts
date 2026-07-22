import { describe, it, expect } from "vitest";
import { MemoryStore, applyEvent } from "../src/index.js";
import type { ProjectionEvent } from "../src/index.js";

describe("identity resolution", () => {
  it("a rename resolves to ONE player and records both names", async () => {
    const s = new MemoryStore();
    const first = await s.createPlayer("OldName", "HASH-A", new Date("2026-07-01T00:00:00Z"));
    await s.recordGamertag(first.id, "OldName", new Date("2026-07-01T00:00:00Z"));

    const found = await s.getPlayerByDayzId("HASH-A");
    expect(found).not.toBeNull();
    expect(found!.id).toBe(first.id);

    await s.recordGamertag(first.id, "NewName", new Date("2026-07-05T00:00:00Z"));
    const after = await s.getPlayerById(first.id);
    expect(after!.gamertag).toBe("NewName");           // current name follows the rename
    expect(await s.gamertagsFor(first.id)).toEqual(["OldName", "NewName"]);
  });

  it("a RECYCLED gamertag resolves to a DIFFERENT player", async () => {
    // The inverse of the rename case, and the one a gamertag-keyed fold gets wrong.
    const s = new MemoryStore();
    const a = await s.createPlayer("Shared", "HASH-A", new Date("2026-07-01T00:00:00Z"));
    const b = await s.createPlayer("Shared2", "HASH-B", new Date("2026-07-02T00:00:00Z"));
    expect(await s.getPlayerByDayzId("HASH-A")).toMatchObject({ id: a.id });
    expect(await s.getPlayerByDayzId("HASH-B")).toMatchObject({ id: b.id });
    expect(a.id).not.toBe(b.id);
  });

  it("returns null for an unknown hash rather than guessing", async () => {
    const s = new MemoryStore();
    expect(await s.getPlayerByDayzId("NOPE")).toBeNull();
  });

  it("a repeat connect under the same name extends last_seen_at, it does not duplicate", async () => {
    const s = new MemoryStore();
    const p = await s.createPlayer("Steady", "HASH-C", new Date("2026-07-01T00:00:00Z"));
    await s.recordGamertag(p.id, "Steady", new Date("2026-07-01T00:00:00Z"));
    await s.recordGamertag(p.id, "Steady", new Date("2026-07-09T00:00:00Z"));
    expect(await s.gamertagsFor(p.id)).toEqual(["Steady"]);
    const row = s.aliases.find((a) => a.playerId === p.id)!;
    expect(row.firstSeenAt.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(row.lastSeenAt.toISOString()).toBe("2026-07-09T00:00:00.000Z");
  });

  it("an out-of-order replay does not rewind last_seen_at", async () => {
    const s = new MemoryStore();
    const p = await s.createPlayer("Steady", "HASH-D", new Date("2026-07-01T00:00:00Z"));
    await s.recordGamertag(p.id, "Steady", new Date("2026-07-09T00:00:00Z"));
    await s.recordGamertag(p.id, "Steady", new Date("2026-07-02T00:00:00Z"));
    expect(s.aliases.find((a) => a.playerId === p.id)!.lastSeenAt.toISOString())
      .toBe("2026-07-09T00:00:00.000Z");
  });
});

// The store-level tests above pin the primitives; these pin the FOLD, which is the feature.
// Without them a revert of onConnected to gamertag-first resolution passes the whole suite.
describe("the fold resolves identity by account hash", () => {
  const ev = (over: Partial<ProjectionEvent>): ProjectionEvent => ({
    id: 1, serverId: 1, type: "player.connected", occurredAt: new Date("2026-07-06T12:00:00Z"),
    payload: { gamertag: "A", dayzId: "A=" }, ...over,
  });

  it("a RENAME (same hash, new name) folds onto the existing player", async () => {
    const s = new MemoryStore();
    await applyEvent(s, ev({}));
    await applyEvent(s, ev({
      id: 2, occurredAt: new Date("2026-07-08T12:00:00Z"),
      payload: { gamertag: "A-Renamed", dayzId: "A=" },
    }));
    expect(s.players.length).toBe(1);
    const p = s.players[0]!;
    expect(p.gamertag).toBe("A-Renamed");                  // current name follows the rename
    expect(await s.gamertagsFor(p.id)).toEqual(["A", "A-Renamed"]);
    // one identity means one life, not two
    expect(s.lives.filter((l) => l.playerId === p.id).length).toBe(1);
    // and the old name still resolves to them
    expect(await s.getPlayerByDayzId("A=")).toMatchObject({ id: p.id });
  });

  it("a RECYCLED gamertag (same name, new hash) folds onto a DIFFERENT player", async () => {
    const s = new MemoryStore();
    await applyEvent(s, ev({}));
    await applyEvent(s, ev({
      id: 2, occurredAt: new Date("2026-07-08T12:00:00Z"),
      payload: { gamertag: "A", dayzId: "B=" },
    }));
    expect(s.players.length).toBe(2);
    const a = (await s.getPlayerByDayzId("A="))!;
    const b = (await s.getPlayerByDayzId("B="))!;
    expect(a.id).not.toBe(b.id);
    // each identity gets its own life — the second player is not handed the first's
    expect(s.lives.filter((l) => l.playerId === a.id).length).toBe(1);
    expect(s.lives.filter((l) => l.playerId === b.id).length).toBe(1);
  });

  it("a hash-less event still resolves by gamertag and creates nothing new", async () => {
    // Hit/build events carry no account hash; the gamertag fallback is why they still work.
    const s = new MemoryStore();
    await applyEvent(s, ev({}));
    await applyEvent(s, ev({ id: 2, occurredAt: new Date("2026-07-06T13:00:00Z"), payload: { gamertag: "A" } }));
    expect(s.players.length).toBe(1);
  });
});
