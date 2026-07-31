import type { LifeTimelineData, PlayerKill, Session, DeathVerdictDto, EncounterDto } from "./types";
import { formatDuration } from "@/components/player/format";

export type Marker = "blue" | "red" | "gray" | "yellow";

export type TimelineEvent =
  | { kind: "now"; at: Date; marker: "blue"; timeLabel: "NOW"; title: string; line: string }
  | { kind: "death"; at: Date; marker: "red"; timeLabel: string; cause: string | null; byGamertag: string | null; weapon: string | null; distanceMeters: number | null; vitals: string | null; verdict: DeathVerdictDto | null }
  | { kind: "kill"; at: Date; marker: "red"; timeLabel: string; victimGamertag: string; weapon: string | null; distanceMeters: number | null; longestKill: boolean }
  | { kind: "session"; at: Date; marker: "gray"; timeLabel: string; title: string; line: string }
  | { kind: "session-group"; at: Date; marker: "gray"; timeLabel: string; title: string; line: string }
  | { kind: "qualified"; at: Date; marker: "blue"; timeLabel: string; title: string; line: string }
  | { kind: "birth"; at: Date; marker: "gray"; timeLabel: string; title: string; line: string }
  | { kind: "encounter"; at: Date; marker: "yellow"; timeLabel: string; title: string; line: string; attackerGamertag: string | null };

export interface LifeTimelineView {
  alive: boolean;
  events: TimelineEvent[];
  hero: { timeAliveSeconds: number; kills: number; longestKillMeters: number | null; sessions: number; qualified: boolean };
}

function elapsedLabel(seconds: number): string {
  const sec = Math.max(0, seconds);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  // `46:06` read as minutes:seconds. The h/m units make the format self-describing —
  // and match formatDuration's vocabulary everywhere else on the site.
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function connMs(s: Session): number {
  return Date.parse(s.connectedAt);
}
function endMs(s: Session, now: Date): number {
  return s.disconnectedAt ? Date.parse(s.disconnectedAt) : now.getTime();
}

/**
 * Live time-alive for an open life: closed sessions count their stored duration; the open
 * session's elapsed time accrues to `lastSeenAt ?? connectedAt` — matching `livePlaytime`'s
 * `upTo = lastSeenAt ?? connectedAt ?? now` idiom in `packages/read-models/src/survivors.ts`
 * EXACTLY (no clamp to `now`), so this page agrees with the survivor board and the dossier
 * standing card byte-for-byte: a crashed/ghosted player stops accruing at their last heartbeat
 * instead of climbing to request-time `now`, and — under game-server-vs-app clock skew, where
 * `lastSeenAt` can land a few seconds ahead of `now` — a still-online player accrues through that
 * heartbeat rather than being clamped short of it. A missing heartbeat (`lastSeenAt` null) falls
 * back to the session's own `connectedAt` — zero additional accrual — rather than growing
 * unbounded.
 */
function liveTimeAlive(sessions: Session[], lastSeenAt: Date | null): number {
  return sessions.reduce((acc, s) => {
    const conn = connMs(s);
    if (s.disconnectedAt) return acc + (s.durationSeconds ?? Math.max(0, Math.floor((Date.parse(s.disconnectedAt) - conn) / 1000)));
    const upToMs = lastSeenAt ? lastSeenAt.getTime() : conn;
    return acc + Math.max(0, Math.floor((upToMs - conn) / 1000));
  }, 0);
}

/**
 * Seconds of PLAYED time accumulated by the instant `at` — the same clock `liveTimeAlive` and
 * `life.playtimeSeconds` count in, evaluated at an arbitrary point rather than only at the end.
 *
 * ⚠️ This is what every timeline offset is measured in, and it is NOT wall-clock time since
 * `life.startedAt`. A life that spans two weeks of real time but three hours of play used to
 * label its events "463h 04m in" directly beneath a hero reading "TIME ALIVE 3h 35m": both
 * numbers were true, but the page presented two different clocks on one axis and read as broken
 * data. Time spent logged off is not time spent alive on the record, so it is not counted here.
 *
 * Session accounting mirrors `liveTimeAlive` EXACTLY so the two can never disagree — a closed
 * session that ended before `at` contributes its STORED `durationSeconds` (not its wall-clock
 * span, which can differ), and an open session accrues only to `lastSeenAt ?? connectedAt`, so a
 * crashed/ghosted player's offsets stop at their last heartbeat instead of climbing to
 * request-time `now`. Only the session containing `at` is pro-rated.
 */
function playedSecondsAt(at: Date, sessions: Session[], lastSeenAt: Date | null): number {
  const t = at.getTime();
  return sessions.reduce((acc, s) => {
    const conn = connMs(s);
    if (t <= conn) return acc; // the session hadn't begun yet
    const cap = s.disconnectedAt ? Date.parse(s.disconnectedAt) : lastSeenAt ? lastSeenAt.getTime() : conn;
    if (t >= cap) {
      return acc + (s.disconnectedAt
        ? s.durationSeconds ?? Math.max(0, Math.floor((cap - conn) / 1000))
        : Math.max(0, Math.floor((cap - conn) / 1000)));
    }
    return acc + Math.max(0, Math.floor((t - conn) / 1000));
  }, 0);
}

function longestOf<T extends { distanceMeters: number | null; at: Date }>(kills: T[]): T | null {
  let best: T | null = null;
  for (const k of kills) {
    if (k.distanceMeters == null) continue;
    if (best === null || k.distanceMeters > best.distanceMeters! || (k.distanceMeters === best.distanceMeters && k.at.getTime() < best.at.getTime())) {
      best = k;
    }
  }
  return best;
}

function qualifiedLine(by: "playtime" | "kill" | "pvp-death"): string {
  if (by === "kill") return "First blood drawn. The life counts from here.";
  if (by === "pvp-death") return "Qualified at the moment of death — killed by a player.";
  return "Five minutes survived. The grace period ends; from here, death counts.";
}

function durLabel(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))}m`;
}

/** Exact copy per spec §7. HP appears only when a tick reported one — never fabricated. */
function encounterText(e: EncounterDto): { title: string; line: string } {
  const hp = e.hpLow == null ? null : `HP down to ${Math.round(e.hpLow)}`;
  const blows = `${e.hits} blow${e.hits === 1 ? "" : "s"}`;
  switch (e.category) {
    case "wolf":
      return { title: e.hits >= 3 ? "Wolves — fought off" : "A wolf — fought off", line: [`${blows} over ${durLabel(e.durationSeconds)}`, hp].filter(Boolean).join(" · ") };
    case "bear":
      return { title: "A bear — fought off", line: [`${blows} over ${durLabel(e.durationSeconds)}`, hp].filter(Boolean).join(" · ") };
    case "animal":
      return { title: "Wild animal — fought off", line: [blows, hp].filter(Boolean).join(" · ") };
    case "infected":
      return e.hits >= 3
        ? { title: `Horde — ${e.hits} blows over ${durLabel(e.durationSeconds)}`, line: hp ?? "Fought clear" }
        : { title: `Infected — ${blows}`, line: hp ?? blows };
    case "player":
      return { title: "Firefight", line: [`${e.hits} hit${e.hits === 1 ? "" : "s"} taken`, e.hpLow == null ? null : `HP ${Math.round(e.hpLow)}`].filter(Boolean).join(" · ") };
    case "fire":
      return { title: `Burned — ${blows}`, line: hp ?? "Got clear of the flames" };
    default:
      return { title: `Took a beating — ${e.hits} hit${e.hits === 1 ? "" : "s"}`, line: hp ?? "Walked it off" };
  }
}

function vitalsLine(life: LifeTimelineData["life"]): string | null {
  const parts: string[] = [];
  if (life.energyAtDeath != null) parts.push(`Energy ${Math.round(life.energyAtDeath)}`);
  if (life.waterAtDeath != null) parts.push(`Water ${Math.round(life.waterAtDeath)}`);
  if (life.bleedSourcesAtDeath != null && life.bleedSourcesAtDeath > 0) parts.push(`bleeding ×${life.bleedSourcesAtDeath}`);
  return parts.length ? parts.join(" · ") : null;
}

/** Pure: LifeTimelineData -> ordered (newest-first) captioned event list + hero stats. */
export function buildTimeline(data: LifeTimelineData, now: Date): LifeTimelineView {
  const startedAt = new Date(data.life.startedAt);
  const endedAt = data.life.endedAt ? new Date(data.life.endedAt) : null;
  const alive = endedAt === null;

  const killObjs = data.kills.map((k: PlayerKill) => ({ ...k, at: new Date(k.occurredAt) }));
  const longest = longestOf(killObjs);
  const lastSeenAt = data.lastSeenAt ? new Date(data.lastSeenAt) : null;
  const timeAlive = alive ? liveTimeAlive(data.sessions, lastSeenAt) : data.life.playtimeSeconds;
  const label = (at: Date) => `${elapsedLabel(playedSecondsAt(at, data.sessions, lastSeenAt))} in`;

  const events: TimelineEvent[] = [];

  // Birth (oldest)
  events.push({ kind: "birth", at: startedAt, marker: "gray", timeLabel: "0h 00m", title: "Washed ashore — life begins", line: "Session 1. Grace period active." });

  // Qualified
  if (data.qualifiedAt) {
    const qAt = new Date(data.qualifiedAt.at);
    events.push({ kind: "qualified", at: qAt, marker: "blue", timeLabel: label(qAt), title: "Life qualified", line: qualifiedLine(data.qualifiedAt.by) });
  }

  // Sessions (skip session 1 = birth); group quiet consecutive runs
  const ordered = [...data.sessions].sort((a, b) => connMs(a) - connMs(b));
  const killMs = killObjs.map((k) => k.at.getTime());
  const hasKill = (s: Session) => killMs.some((t) => t >= connMs(s) && t <= endMs(s, now));
  let i = 1;
  while (i < ordered.length) {
    if (!hasKill(ordered[i]!)) {
      let j = i;
      while (j < ordered.length && !hasKill(ordered[j]!)) j++;
      if (j - i >= 2) {
        const first = ordered[i]!;
        events.push({ kind: "session-group", at: new Date(connMs(first)), marker: "gray", timeLabel: label(new Date(connMs(first))), title: `Sessions ${i + 1}–${j}`, line: `${j - i} logins` });
      } else {
        const s = ordered[i]!;
        events.push({ kind: "session", at: new Date(connMs(s)), marker: "gray", timeLabel: label(new Date(connMs(s))), title: `Session ${i + 1} began`, line: "Logged in." });
      }
      i = j;
    } else {
      const s = ordered[i]!;
      events.push({ kind: "session", at: new Date(connMs(s)), marker: "gray", timeLabel: label(new Date(connMs(s))), title: `Session ${i + 1} began`, line: "Logged in." });
      i++;
    }
  }

  // Kills
  for (const k of killObjs) {
    events.push({ kind: "kill", at: k.at, marker: "red", timeLabel: label(k.at), victimGamertag: k.victimGamertag, weapon: k.weapon, distanceMeters: k.distanceMeters, longestKill: longest !== null && k === longest });
  }

  // Encounters
  for (const e of data.encounters) {
    const at = new Date(e.startedAt);
    const { title, line } = encounterText(e);
    events.push({ kind: "encounter", at, marker: "yellow", timeLabel: label(at), title, line, attackerGamertag: e.attackerGamertag });
  }

  // Terminal: now (alive) or death (dead)
  if (alive) {
    // No "and counting" — this line is a server-baked snapshot that never ticks, capped at
    // lastSeenAt; claiming a live counter would be dishonest (spec: live-data-honesty §3).
    events.push({ kind: "now", at: now, marker: "blue", timeLabel: "NOW", title: "Still drawing breath", line: formatDuration(timeAlive) });
  } else {
    // ⚠️ The terminal row is labelled from `timeAlive` — the life's STORED `playtimeSeconds` —
    // not from `playedSecondsAt(endedAt)`. The two agree to the minute in ordinary data, but the
    // stored total is what the hero band, the survivor board and the obituary all print, and the
    // last row of a life's timeline is precisely where a one-minute disagreement would be read as
    // a bug. The hero wins.
    events.push({ kind: "death", at: endedAt, marker: "red", timeLabel: `${elapsedLabel(timeAlive)} in`, cause: data.life.deathCause, byGamertag: data.life.deathByGamertag, weapon: data.life.deathWeapon, distanceMeters: data.life.deathDistance, vitals: vitalsLine(data.life), verdict: data.verdict ?? null });
  }

  // Newest-first
  events.sort((a, b) => b.at.getTime() - a.at.getTime());

  return {
    alive,
    events,
    hero: { timeAliveSeconds: timeAlive, kills: killObjs.length, longestKillMeters: longest?.distanceMeters ?? null, sessions: data.sessions.length, qualified: data.qualifiedAt !== null },
  };
}
