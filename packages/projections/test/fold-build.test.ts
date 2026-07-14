import { describe, it, expect } from "vitest";
import { MemoryStore, applyEvent } from "../src/index.js";
import type { ProjectionEvent } from "../src/index.js";

const connect = (id: number, g: string, at: string): ProjectionEvent => ({
  id, serverId: 1, type: "player.connected", occurredAt: new Date(at), payload: { gamertag: g, dayzId: `${g}=` },
});

describe("build fold", () => {
  it("records a build, links player and current life", async () => {
    const s = new MemoryStore();
    await applyEvent(s, connect(1, "B", "2026-07-06T12:00:00Z"));
    await applyEvent(s, { id: 2, serverId: 1, type: "build.built", occurredAt: new Date("2026-07-06T12:05:00Z"),
      payload: { gamertag: "B", action: "built", object: "base on Fence", className: null, tool: "Farming Hoe", x: 100, y: 200 } });
    expect(s.builds.length).toBe(1);
    expect(s.builds[0]!.playerId).not.toBeNull();
    expect(s.builds[0]!.lifeId).not.toBeNull();
    expect(s.builds[0]).toMatchObject({ action: "built", object: "base on Fence", x: 100, y: 200 });
  });
});
