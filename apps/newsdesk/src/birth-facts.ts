import type { LifeTimeline, PlayerPriors } from "@onelife/read-models";
import type { BirthNoticeTarget } from "./birth-pg-store.js";

export interface BirthFacts {
  gamertag: string;
  map: string;
  mapSlug: string | null;
  lifeNumber: number;
  bornAt: Date;
  minutesToQualify: number | null;   // whole minutes from bornAt to qualification; null if unqualified
  persona: string | null;            // resolved character name, or null
  priors: PlayerPriors;              // the player's global reputation before this life
  isKnownQuantity: boolean;          // priors.livesLived > 0
  endedAt: Date | null;              // set if the life already died before the sweep
}

/** Compose the arrival snapshot a birth notice is built from: the thin current life folded
 *  together with the player's global priors. This object is what rides into the `facts` jsonb. */
export function buildBirthFacts(
  target: BirthNoticeTarget,
  timeline: LifeTimeline,
  priors: PlayerPriors,
): BirthFacts {
  const minutesToQualify = timeline.qualifiedAt
    ? Math.floor((timeline.qualifiedAt.at.getTime() - target.lifeStartedAt.getTime()) / 60000)
    : null;

  return {
    gamertag: target.gamertag,
    map: target.map,
    mapSlug: target.mapSlug,
    lifeNumber: target.lifeNumber,
    bornAt: target.lifeStartedAt,
    minutesToQualify,
    persona: timeline.character?.name ?? null,
    priors,
    isKnownQuantity: priors.livesLived > 0,
    endedAt: target.endedAt,
  };
}
