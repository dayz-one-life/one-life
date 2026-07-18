import type { LifeTimelineData, PlayerKill, Session, DeathVerdictDto } from "./types";
import { formatDuration } from "@/components/player/format";

export type Marker = "blue" | "red" | "gray" | "yellow";

export type TimelineEvent =
  | { kind: "now"; at: Date; marker: "blue"; timeLabel: "NOW"; title: string; line: string }
  | { kind: "death"; at: Date; marker: "red"; timeLabel: string; cause: string | null; byGamertag: string | null; weapon: string | null; distanceMeters: number | null; vitals: string | null; verdict: DeathVerdictDto | null }
  | { kind: "kill"; at: Date; marker: "red"; timeLabel: string; victimGamertag: string; weapon: string | null; distanceMeters: number | null; longestKill: boolean }
  | { kind: "session"; at: Date; marker: "gray"; timeLabel: string; title: string; line: string }
  | { kind: "session-group"; at: Date; marker: "gray"; timeLabel: string; title: string; line: string }
  | { kind: "qualified"; at: Date; marker: "blue"; timeLabel: string; title: string; line: string }
  | { kind: "birth"; at: Date; marker: "gray"; timeLabel: string; title: string; line: string };

export interface LifeTimelineView {
  alive: boolean;
  events: TimelineEvent[];
  hero: { timeAliveSeconds: number; kills: number; longestKillMeters: number | null; sessions: number; qualified: boolean };
}

function elapsedLabel(at: Date, startedAt: Date): string {
  const sec = Math.max(0, Math.floor((at.getTime() - startedAt.getTime()) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function connMs(s: Session): number {
  return Date.parse(s.connectedAt);
}
function endMs(s: Session, now: Date): number {
  return s.disconnectedAt ? Date.parse(s.disconnectedAt) : now.getTime();
}

function liveTimeAlive(sessions: Session[], now: Date): number {
  return sessions.reduce((acc, s) => {
    const conn = connMs(s);
    if (s.disconnectedAt) return acc + (s.durationSeconds ?? Math.max(0, Math.floor((Date.parse(s.disconnectedAt) - conn) / 1000)));
    return acc + Math.max(0, Math.floor((now.getTime() - conn) / 1000));
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
  const label = (at: Date) => `${elapsedLabel(at, startedAt)} IN`;

  const killObjs = data.kills.map((k: PlayerKill) => ({ ...k, at: new Date(k.occurredAt) }));
  const longest = longestOf(killObjs);
  const timeAlive = alive ? liveTimeAlive(data.sessions, now) : data.life.playtimeSeconds;

  const events: TimelineEvent[] = [];

  // Birth (oldest)
  events.push({ kind: "birth", at: startedAt, marker: "gray", timeLabel: "00:00", title: "Washed ashore — life begins", line: "Session 1. Grace period active." });

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

  // Terminal: now (alive) or death (dead)
  if (alive) {
    events.push({ kind: "now", at: now, marker: "blue", timeLabel: "NOW", title: "Still drawing breath", line: `${formatDuration(timeAlive)} and counting` });
  } else {
    events.push({ kind: "death", at: endedAt, marker: "red", timeLabel: label(endedAt), cause: data.life.deathCause, byGamertag: data.life.deathByGamertag, weapon: data.life.deathWeapon, distanceMeters: data.life.deathDistance, vitals: vitalsLine(data.life), verdict: data.verdict ?? null });
  }

  // Newest-first
  events.sort((a, b) => b.at.getTime() - a.at.getTime());

  return {
    alive,
    events,
    hero: { timeAliveSeconds: timeAlive, kills: killObjs.length, longestKillMeters: longest?.distanceMeters ?? null, sessions: data.sessions.length, qualified: data.qualifiedAt !== null },
  };
}
