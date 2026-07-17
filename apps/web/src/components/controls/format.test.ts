import { describe, expect, test } from "vitest";
import type { AccountStatus } from "@/lib/account-status";
import type { Server, ServerStanding } from "@/lib/types";
import {
  diedAtLabel, initialOf, pillStatus, serverCards, serverFactLine, transferErrorLabel,
} from "./format";

const NOW = new Date("2026-07-16T12:00:00Z");

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

const VERIFIED: AccountStatus = { kind: "verified", link: { id: 1, gamertag: "Boots", status: "verified", verifiedAt: "2026-07-01T00:00:00Z", challenge: null } };

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

describe("pillStatus", () => {
  test("banned beats everything; soonest lift wins; tone red", () => {
    const cards = serverCards(
      [server({ id: 1, slug: "chernarus", map: "chernarusplus" }), server({ id: 2, slug: "sakhal", map: "sakhal" })],
      [bannedStanding("sakhal", "sakhal", "2026-07-17T01:58:00Z"), aliveStanding("chernarus", "chernarusplus", 100)],
    );
    expect(pillStatus(VERIFIED, cards, NOW)).toEqual({ text: "Sakhal ban lifts in 13h 58m", tone: "red" });
  });
  test("pending shows emote progress in yellow", () => {
    const st: AccountStatus = { kind: "pending", link: { id: 1, gamertag: "Boots", status: "pending", verifiedAt: null, challenge: { sequence: ["facepalm", "salute", "clap"], progressIndex: 1, expiresAt: "2026-07-17T00:00:00Z", expired: false } } };
    expect(pillStatus(st, [], NOW)).toEqual({ text: "Verify: 1/3 done", tone: "yellow" });
  });
  test("expired pending says so", () => {
    const st: AccountStatus = { kind: "pending", link: { id: 1, gamertag: "Boots", status: "pending", verifiedAt: null, challenge: { sequence: ["facepalm"], progressIndex: 0, expiresAt: "2026-07-15T00:00:00Z", expired: true } } };
    expect(pillStatus(st, [], NOW)).toEqual({ text: "Verification expired", tone: "yellow" });
  });
  test("unlinked invites the link", () => {
    expect(pillStatus({ kind: "unlinked" }, [], NOW)).toEqual({ text: "Link your gamertag →", tone: "dim" });
  });
  test("alive shows the longest-lived life in dim", () => {
    const cards = serverCards(
      [server({ id: 1, slug: "chernarus", map: "chernarusplus" }), server({ id: 2, slug: "sakhal", map: "sakhal" })],
      [aliveStanding("chernarus", "chernarusplus", 100), aliveStanding("sakhal", "sakhal", 22920)],
    );
    expect(pillStatus(VERIFIED, cards, NOW)).toEqual({ text: "Sakhal · 6h 22m this life", tone: "dim" });
  });
  test("verified with nothing going on: no active life, muted", () => {
    const cards = serverCards([server({})], []);
    expect(pillStatus(VERIFIED, cards, NOW)).toEqual({ text: "No active life", tone: "muted" });
  });
  test("banned with no expiry (lift pending) falls back to the plain banned line", () => {
    const cards = serverCards([server({ id: 2, slug: "sakhal", map: "sakhal" })], [bannedStanding("sakhal", "sakhal", null)]);
    expect(pillStatus(VERIFIED, cards, NOW)).toEqual({ text: "Sakhal banned", tone: "red" });
  });
});
