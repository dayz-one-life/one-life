import { describe, it, expect } from "vitest";
import { MemoryStore } from "../src/index.js";

describe("MemoryStore", () => {
  it("creates and finds a player by gamertag", async () => {
    const s = new MemoryStore();
    const p = await s.createPlayer("A", "A=", new Date("2026-07-06T12:00:00Z"));
    expect(await s.getPlayer("A")).toMatchObject({ id: p.id, gamertag: "A" });
    expect(await s.getPlayer("B")).toBeNull();
  });
  it("tracks max life number per player", async () => {
    const s = new MemoryStore();
    const p = await s.createPlayer("A", null, new Date());
    expect(await s.getMaxLifeNumber(1, p.id)).toBe(0);
    await s.createLife(1, p.id, 1, new Date());
    expect(await s.getMaxLifeNumber(1, p.id)).toBe(1);
  });
});

describe("MemoryStore global players", () => {
  it("resolves one player by gamertag regardless of server", async () => {
    const s = new MemoryStore();
    const p = await s.createPlayer("Bob", null, new Date("2026-07-01"));
    // seen again 'on another server' — still the same player row
    expect((await s.getPlayer("Bob"))?.id).toBe(p.id);
    expect("currentLifeId" in (await s.getPlayer("Bob"))!).toBe(false);
  });
});
