import { and, eq, gte, lte, desc } from "drizzle-orm";
import { type Database, characterSightings, characters } from "@onelife/db";
import { rosterByClass } from "@onelife/domain";

export type LifeCharacter = {
  charId: number;
  characterClass: string | null;
  name: string | null;
  gender: string | null;
  sightings: number;
  confidence: "exact" | "ambiguous";
};

const SLACK_MS = 5 * 60 * 1000;

/**
 * Resolve the character a life was played as, by joining character sightings to the life's
 * gamertag + time window (never `lives.id` → rebuild-safe). Class comes from the `characters`
 * rollup (charID inheritance); name/gender from the roster.
 */
export async function getLifeCharacter(
  db: Database,
  serverId: number,
  gamertag: string,
  startedAt: Date,
  endedAt: Date | null,
): Promise<LifeCharacter | null> {
  const lo = new Date(startedAt.getTime() - SLACK_MS);
  const hi = new Date((endedAt ?? new Date()).getTime() + SLACK_MS);

  const sights = await db
    .select({ charId: characterSightings.charId })
    .from(characterSightings)
    .where(
      and(
        eq(characterSightings.serverId, serverId),
        eq(characterSightings.gamertag, gamertag),
        gte(characterSightings.observedAt, lo),
        lte(characterSightings.observedAt, hi),
      ),
    );
  if (sights.length === 0) return null;

  const counts = new Map<number, number>();
  for (const s of sights) counts.set(s.charId, (counts.get(s.charId) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [charId, count] = ranked[0]!;

  const [rollup] = await db
    .select({ cls: characters.characterClass })
    .from(characters)
    .where(and(eq(characters.serverId, serverId), eq(characters.charId, charId)))
    .orderBy(desc(characters.lastSeenAt))
    .limit(1);
  const cls = rollup?.cls ?? null;
  const roster = cls ? rosterByClass(cls) : null;

  return {
    charId,
    characterClass: cls,
    name: roster?.name ?? null,
    gender: roster?.gender ?? null,
    sightings: count,
    confidence: ranked.length > 1 ? "ambiguous" : "exact",
  };
}
