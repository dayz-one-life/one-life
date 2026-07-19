import { QUALIFY_SECONDS } from "@onelife/domain";

export { livePlaytime } from "./playtime.js";

/** A life counts only once it has survived 5 minutes of accumulated playtime OR seen lethal PvP. */
export { QUALIFY_SECONDS };

export type QualificationInput = {
  deathCause: string | null;         // lives.death_cause ("pvp" = the victim died in PvP)
  effectivePlaytimeSeconds: number;  // livePlaytime(stored, openSession, lastSeenAt) for this life
  startedAt: Date;                   // life.started_at
  windowEnd: Date;                   // life.ended_at ?? lastSeenAt ?? now — upper bound of the kill window
  playerKills: { occurredAt: Date }[]; // kills scored by this player on this server (killer_gamertag = player)
};

export function isLifeQualified(input: QualificationInput): boolean {
  if (input.deathCause === "pvp") return true;               // killed by a player
  const s = input.startedAt.getTime(), e = input.windowEnd.getTime();
  if (input.playerKills.some((k) => { const ts = k.occurredAt.getTime(); return ts >= s && ts <= e; })) {
    return true;                                             // scored a kill during this life
  }
  return input.effectivePlaytimeSeconds >= QUALIFY_SECONDS;  // survived 5 minutes
}

export type LifeSessionSlice = {
  connectedAt: Date;
  disconnectedAt: Date | null;
  durationSeconds: number | null;
};

export type QualifiedAtInput = {
  startedAt: Date;
  endedAt: Date | null;
  deathCause: string | null;
  sessions: LifeSessionSlice[];   // this life's sessions
  lastSeenAt: Date | null;        // player heartbeat — caps the open session (ghost never crosses)
  playerKills: { occurredAt: Date }[];
};

export type QualifiedAt = { at: Date; by: "playtime" | "kill" | "pvp-death" };

/** The instant a life qualified — earliest of playtime crossing QUALIFY_SECONDS, first kill in the
 *  life window, or a PvP death. Pure and stable once defined: more history never moves it.
 *  Returns null while the life is provisional (or was discarded). Must agree with isLifeQualified. */
export function lifeQualifiedAt(input: QualifiedAtInput): QualifiedAt | null {
  const candidates: QualifiedAt[] = [];

  if (input.deathCause === "pvp" && input.endedAt) {
    candidates.push({ at: input.endedAt, by: "pvp-death" });
  }

  const s = input.startedAt.getTime();
  const e = input.endedAt?.getTime() ?? Infinity;
  const killMs = input.playerKills
    .map((k) => k.occurredAt.getTime())
    .filter((t) => t >= s && t <= e);
  if (killMs.length > 0) candidates.push({ at: new Date(Math.min(...killMs)), by: "kill" });

  let acc = 0;
  const ordered = [...input.sessions].sort((a, b) => a.connectedAt.getTime() - b.connectedAt.getTime());
  for (const sess of ordered) {
    const start = sess.connectedAt.getTime();
    const contribution = sess.disconnectedAt
      ? sess.durationSeconds ?? Math.max(0, Math.floor((sess.disconnectedAt.getTime() - start) / 1000))
      : input.lastSeenAt
        ? Math.max(0, Math.floor((input.lastSeenAt.getTime() - start) / 1000))
        : 0;
    if (acc + contribution >= QUALIFY_SECONDS) {
      candidates.push({ at: new Date(start + (QUALIFY_SECONDS - acc) * 1000), by: "playtime" });
      break;
    }
    acc += contribution;
  }

  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (b.at.getTime() < a.at.getTime() ? b : a));
}
