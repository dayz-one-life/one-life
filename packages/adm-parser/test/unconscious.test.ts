import { describe, it, expect } from "vitest";
import { parseUnconscious } from "../src/unconscious.js";

describe("parseUnconscious", () => {
  it("parses a plain unconscious line", () => {
    const raw = `09:25:31 | Player "XxBE4zyxX" (id=D34AD4C2D9A2D1068C2B4971CAA01177C20B24C1 pos=<5963.2, 4071.0, 397.1>) is unconscious`;
    expect(parseUnconscious(raw)).toEqual({
      gamertag: "XxBE4zyxX", disconnecting: false, x: 5963.2, y: 4071.0,
    });
  });

  it("parses the combat-log form and flags it", () => {
    const raw = `09:25:58 | Player "XxBE4zyxX" (id=D34AD4C2D9A2D1068C2B4971CAA01177C20B24C1 pos=<5965.9, 4069.1, 397.1>) is disconnecting while being unconscious`;
    expect(parseUnconscious(raw)).toEqual({
      gamertag: "XxBE4zyxX", disconnecting: true, x: 5965.9, y: 4069.1,
    });
  });

  // A corpse line is post-death noise, not evidence about a living player.
  it("ignores a (DEAD) unconscious line", () => {
    const raw = `10:01:02 | Player "Cee Lo GREEN 96" (DEAD) (pos=<8186.4, 12779.7, 116.9>) is unconscious`;
    expect(parseUnconscious(raw)).toBeNull();
  });

  // We record going DOWN, not a consciousness state machine. 45 such lines exist in prod.
  it("ignores a regained-consciousness line", () => {
    const raw = `09:26:40 | Player "XxBE4zyxX" (id=D34AD4C2 pos=<5965.9, 4069.1, 397.1>) regained consciousness`;
    expect(parseUnconscious(raw)).toBeNull();
  });

  it("returns null for an unrelated line", () => {
    expect(parseUnconscious(`09:25:44 | Player "X" (id=A pos=<1, 2, 3>) has been disconnected`)).toBeNull();
  });
});
