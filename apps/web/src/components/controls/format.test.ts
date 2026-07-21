import { describe, expect, test } from "vitest";
import type { Server, ServerStanding } from "@/lib/types";
import {
  diedAtLabel, initialOf, serverCards, serverFactLine, transferErrorLabel,
} from "./format";

const server = (over: Partial<Server>): Server => ({
  id: 1, nitradoServiceId: 1, name: "s", map: "chernarusplus", slug: "chernarus",
  active: true, clockOffsetMs: 0, createdAt: "2026-01-01T00:00:00Z", ...over,
});

const standing = (over: Partial<ServerStanding>): ServerStanding => ({
  serverId: 1, map: "chernarusplus", slug: "chernarus", state: "idle",
  character: null, alive: null, ban: null, ...over,
});

const aliveStanding = (slug: string, map: string, secs: number, kills = 0): ServerStanding =>
  standing({
    slug, map, state: "alive",
    alive: { lifeId: 1, lifeNumber: 1, startedAt: "2026-07-16T05:00:00Z", timeAliveSeconds: secs, kills, longestKillMeters: null, killList: [] },
  });

const bannedStanding = (slug: string, map: string, expiresAt: string | null): ServerStanding =>
  standing({
    slug, map, state: "banned",
    ban: { banId: 9, bannedAt: "2026-07-16T09:47:00Z", expiresAt, liftPending: false, triggeringLifeNumber: 1 },
  });

describe("initialOf", () => {
  test("uppercases the first character", () => expect(initialOf("boots")).toBe("B"));
  test("falls back on empty input", () => expect(initialOf("  ")).toBe("?"));
});

describe("diedAtLabel", () => {
  test("renders zero-padded local HH:MM", () => {
    const d = new Date("2026-07-16T09:47:00Z");
    const expected = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    expect(diedAtLabel("2026-07-16T09:47:00Z")).toBe(expected);
  });
});

describe("serverCards", () => {
  test("one card per active slugged server; unmatched servers are idle", () => {
    const cards = serverCards(
      [server({ id: 1, slug: "chernarus", map: "chernarusplus" }), server({ id: 2, slug: "sakhal", map: "sakhal" }), server({ id: 3, slug: null })],
      [aliveStanding("chernarus", "chernarusplus", 22920, 0)],
    );
    expect(cards.map((c) => [c.slug, c.state])).toEqual([["chernarus", "alive"], ["sakhal", "idle"]]);
  });
});

describe("serverFactLine", () => {
  test("alive line has time and pluralized kills", () => {
    const [c] = serverCards([server({})], [aliveStanding("chernarus", "chernarusplus", 22920, 1)]);
    expect(serverFactLine(c!)).toBe("Qualified · 6h 22m this life · 1 kill");
  });
  test("alive line pluralizes zero kills", () => {
    const [c] = serverCards([server({})], [aliveStanding("chernarus", "chernarusplus", 22920, 0)]);
    expect(serverFactLine(c!)).toBe("Qualified · 6h 22m this life · 0 kills");
  });
  test("idle line is the grace invitation", () => {
    const [c] = serverCards([server({})], []);
    expect(serverFactLine(c!)).toBe("Spawn in any time. First 5 minutes are free.");
  });
  test("banned line is the died-at stamp", () => {
    const [c] = serverCards([server({})], [bannedStanding("chernarus", "chernarusplus", null)]);
    expect(serverFactLine(c!)).toBe(`Died ${diedAtLabel("2026-07-16T09:47:00Z")}`);
  });
});

describe("transferErrorLabel", () => {
  test("maps the API codes", () => {
    expect(transferErrorLabel("not_verified")).toBe("Not a verified player");
    expect(transferErrorLabel("insufficient_tokens")).toBe("Not enough tokens");
    expect(transferErrorLabel("self_transfer")).toBe("That's you");
    expect(transferErrorLabel("already_set")).toBe("Already set");
    expect(transferErrorLabel("boom")).toBe("Something went wrong");
  });
});
