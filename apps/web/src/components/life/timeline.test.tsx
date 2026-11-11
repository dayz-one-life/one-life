import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Timeline } from "./timeline";
import { buildTimeline } from "@/lib/life-timeline";
import type { DeathVerdictDto, LifeTimelineData } from "@/lib/types";

const BASE: DeathVerdictDto = {
  status: "final", key: "unknown", tag: null, certainty: "definitive", label: "", detail: null, sentence: "", caption: null,
  killerGamertag: null, driverGamertag: null, credit: null, trap: false, selfStated: false, cause: "unknown", confidence: "low", conditions: [],
};
const death = (o: Partial<DeathVerdictDto>): DeathVerdictDto => ({ ...BASE, ...o });

const start = "2026-07-14T00:00:00Z";
const at = (m: number) => new Date(Date.parse(start) + m * 60_000).toISOString();
function data(over: Partial<LifeTimelineData> = {}): LifeTimelineData {
  return {
    gamertag: "YrJustBad", map: "sakhal", slug: "sakhal", lastSeenAt: null,
    life: { id: 1, serverId: 1, playerId: 1, lifeNumber: 4, startedAt: start, endedAt: null, deathCause: null, deathByGamertag: null, deathWeapon: null, deathDistance: null, energyAtDeath: null, waterAtDeath: null, bleedSourcesAtDeath: null, playtimeSeconds: 0, endReason: null },
    sessions: [{ id: 1, serverId: 1, playerId: 1, lifeId: 1, connectedAt: start, disconnectedAt: null, durationSeconds: null, closeReason: null }],
    kills: [{ victimGamertag: "Tomahawked11", weapon: "VSS", distanceMeters: 5, occurredAt: at(90), basis: "kill_line" }],
    qualifiedAt: { at: at(5), by: "playtime" },
    encounters: [],
    verdict: null,
    avatarHash: null,
    obituarySlug: null,
    ...over,
  };
}

describe("Timeline", () => {
  test("alive: shows the Positions withheld bar and a NOW label", () => {
    const now = new Date(Date.parse(start) + 200 * 60_000);
    render(<Timeline view={buildTimeline(data(), now)} />);
    expect(screen.getByText("Positions withheld")).toBeInTheDocument();
    expect(screen.getByText("NOW")).toBeInTheDocument();
    expect(screen.getByText("Still drawing breath")).toBeInTheDocument();
  });

  test("kill row links the victim and shows weapon · distance", () => {
    const now = new Date(Date.parse(start) + 200 * 60_000);
    render(<Timeline view={buildTimeline(data(), now)} />);
    expect(screen.getByRole("link", { name: "Tomahawked11" })).toBeInTheDocument();
    expect(screen.getByText(/VSS · 5 m/)).toBeInTheDocument();
  });

  test("dead: no withheld bar, death row shows killer + vitals", () => {
    const now = new Date(Date.parse(start) + 400 * 60_000);
    const d = data({
      kills: [],
      life: { ...data().life, endedAt: at(360), endReason: "death", deathCause: "pvp", deathByGamertag: "SomeKiller", deathWeapon: "VSD", deathDistance: 126, energyAtDeath: 42, waterAtDeath: 18, bleedSourcesAtDeath: 2, playtimeSeconds: 21600 },
    });
    render(<Timeline view={buildTimeline(d, now)} />);
    expect(screen.queryByText("Positions withheld")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "SomeKiller" })).toBeInTheDocument();
    expect(screen.getByText(/Energy 42 · Water 18 · bleeding ×2/)).toBeInTheDocument();
  });

  test("longest kill row shows the Longest kill chip", () => {
    const now = new Date(Date.parse(start) + 500 * 60_000);
    const d = data({ kills: [{ victimGamertag: "V", weapon: "KAS-74U", distanceMeters: 25, occurredAt: at(120), basis: "kill_line" }] });
    render(<Timeline view={buildTimeline(d, now)} />);
    expect(screen.getByText("Longest kill")).toBeInTheDocument();
  });

  const dead = (verdict: DeathVerdictDto, life: Partial<LifeTimelineData["life"]> = {}) => {
    const now = new Date(Date.parse(start) + 400 * 60_000);
    const d = data({
      kills: [], verdict,
      life: { ...data().life, endedAt: at(360), endReason: "death", deathCause: "died", energyAtDeath: 0, waterAtDeath: 10, bleedSourcesAtDeath: 0, playtimeSeconds: 21600, ...life },
    });
    return render(<Timeline view={buildTimeline(d, now)} />);
  };

  test("a non-pvp death prints the sentence, then detail and vitals", () => {
    dead(death({ key: "explosion", label: "Explosion", sentence: "Killed by a 40mm explosive round.", detail: "40mm round" }));
    expect(screen.getByText("Killed by a 40mm explosive round.")).toBeInTheDocument();
    expect(screen.getByText(/40mm round · Energy 0 · Water 10/)).toBeInTheDocument();
  });

  test("a strong death carries its caption", () => {
    dead(death({ certainty: "strong", label: "Starvation", sentence: "Starved to death.", caption: "Worked out from the log" }));
    expect(screen.getByText("Starved to death.")).toBeInTheDocument();
    expect(screen.getByText("Worked out from the log")).toBeInTheDocument();
  });

  test("an inferred death reads \"Likely\" with its caption", () => {
    dead(death({ certainty: "inferred", label: "Likely starvation and thirst", sentence: "Likely starved and dehydrated.", caption: "Best reading of the log. The server recorded no cause." }));
    expect(screen.getByText("Likely starved and dehydrated.")).toBeInTheDocument();
    expect(screen.getByText("Best reading of the log. The server recorded no cause.")).toBeInTheDocument();
  });

  test("a pending death reads \"Awaiting the record\"", () => {
    dead(death({ status: "pending", key: "awaiting", certainty: "unknown", label: "Awaiting the record", sentence: "Awaiting the record." }));
    expect(screen.getByText(/Awaiting the record/)).toBeInTheDocument();
  });

  test("a pending PvP death still links the killer", () => {
    dead(death({ status: "pending", key: "pvp", label: "Killed by SomeKiller", sentence: "Killed by SomeKiller.", killerGamertag: "SomeKiller" }),
      { deathCause: "pvp", deathByGamertag: "SomeKiller" });
    expect(screen.getByRole("link", { name: "SomeKiller" })).toBeInTheDocument();
  });

  test("a driver is never linked", () => {
    dead(death({ key: "hit_by_vehicle_driver", label: "Hit by a vehicle", sentence: "Hit by a vehicle. The log puts Driver Dan in the driver's seat.", driverGamertag: "Driver Dan" }),
      { deathCause: "pvp", deathByGamertag: "Driver Dan" });
    expect(screen.getByText(/The log puts Driver Dan in the driver's seat/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Driver Dan" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Killed by Driver Dan/)).not.toBeInTheDocument();
  });

  test("a credit prints \"Kill credited to\" with a link and the caption, and never \"Killed by NAME\"", () => {
    dead(death({
      key: "tripwire", label: "Tripwire", trap: true, detail: "M67 frag grenade",
      sentence: "Killed by a tripwire rigged with an M67 frag grenade. Kill credited to Placer Person.",
      caption: "The log names no killer. Placer Person placed the only tripwire it records at this spot.",
      credit: { gamertag: "Placer Person", basis: "trap_placement", device: "tripwire", byOperator: false },
    }), { deathCause: "explosion" });
    expect(screen.getByText(/Killed by a tripwire rigged with an M67 frag grenade\./)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Placer Person" });
    expect(link.closest("p")).toHaveTextContent("Kill credited to Placer Person.");
    expect(screen.getByText("The log names no killer. Placer Person placed the only tripwire it records at this spot.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Killed by Placer Person/);
  });

  test("an old payload with only the legacy triple still prints a phrase", () => {
    dead({ cause: "starvation", confidence: "low", conditions: ["starving"] } as unknown as DeathVerdictDto, { deathCause: "environment" });
    expect(screen.getByText(/Likely starvation/i)).toBeInTheDocument();
  });

  test("a trap kill row is marked \"by trap\" and the list carries the footnote", () => {
    const now = new Date(Date.parse(start) + 200 * 60_000);
    render(<Timeline view={buildTimeline(data({ kills: [{ victimGamertag: "Victim One", weapon: "Tripwire", distanceMeters: null, occurredAt: at(90), basis: "trap_placement" }] }), now)} />);
    expect(screen.getByText("Tripwire · by trap")).toBeInTheDocument();
    expect(screen.getByText("By trap: credited from where the trap was placed. The log names no killer.")).toBeInTheDocument();
  });

  test("a list with no trap kill has no footnote", () => {
    const now = new Date(Date.parse(start) + 200 * 60_000);
    render(<Timeline view={buildTimeline(data(), now)} />);
    expect(screen.queryByText(/By trap:/)).not.toBeInTheDocument();
  });

  test("event sequence is an ordered list — one listitem per event, list-none reset", () => {
    const now = new Date(Date.parse(start) + 400 * 60_000);
    const d = data({
      kills: [{ victimGamertag: "V", weapon: "KAS-74U", distanceMeters: 25, occurredAt: at(120), basis: "kill_line" }],
      life: { ...data().life, endedAt: at(360), endReason: "death", deathCause: "pvp", deathByGamertag: "SomeKiller", deathWeapon: "VSD", deathDistance: 126, energyAtDeath: 42, waterAtDeath: 18, bleedSourcesAtDeath: 2, playtimeSeconds: 21600 },
    });
    const view = buildTimeline(d, now);
    render(<Timeline view={view} />);
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("OL");
    expect(list.className).toContain("list-none");
    expect(list.className).toContain("mt-4");
    expect(screen.getAllByRole("listitem")).toHaveLength(view.events.length);
  });

  test("encounter row shows title, line, a yellow dot, and links the attacker for a player encounter", () => {
    const now = new Date(Date.parse(start) + 200 * 60_000);
    const d = data({
      kills: [],
      encounters: [{ category: "player", attackerGamertag: "Raider", startedAt: at(30), durationSeconds: 30, hits: 3, hpLow: 58 }],
    });
    render(<Timeline view={buildTimeline(d, now)} />);
    expect(screen.getByText(/Firefight/)).toBeInTheDocument();
    expect(screen.getByText("3 hits taken · HP 58")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Raider" })).toBeInTheDocument();
    const dot = document.querySelector(".bg-yellow");
    expect(dot).toBeInTheDocument();
  });
});
