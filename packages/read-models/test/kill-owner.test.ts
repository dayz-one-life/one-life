import { describe, it, expect } from "vitest";
import { isKillByPlayer } from "../src/kill-owner.js";

// Whose kill a `kills` row is. Invented names throughout.
describe("isKillByPlayer", () => {
  const player = { playerId: 7, gamertag: "KO Newname" };

  it("matches on the player id whatever name the row carries", () => {
    expect(isKillByPlayer({ killerPlayerId: 7, killerGamertag: "KO Oldname" }, player)).toBe(true);
  });
  it("does not match another player's kill that carries this player's current name", () => {
    expect(isKillByPlayer({ killerPlayerId: 8, killerGamertag: "KO Newname" }, player)).toBe(false);
  });
  it("falls back to the name, ignoring case, only when the row has no id", () => {
    expect(isKillByPlayer({ killerPlayerId: null, killerGamertag: "ko newname" }, player)).toBe(true);
    expect(isKillByPlayer({ killerPlayerId: null, killerGamertag: "KO Oldname" }, player)).toBe(false);
  });
});
