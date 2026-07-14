import { and, eq, desc } from "drizzle-orm";
import { type Database, characterSightings, characters } from "@onelife/db";
import { parseRptFile, type CharacterSighting } from "@onelife/rpt-parser";

export type ProcessRptOpts = {
  serverId: number;
  rptFileId: number;
  content: string;
  offsetMs: number;
  charStaleHours: number;
};

/** Parse an RPT file's content → append character sightings (idempotent) + upsert the rollup. */
export async function processRptContent(db: Database, opts: ProcessRptOpts): Promise<{ sightings: number }> {
  const parsed = parseRptFile(opts.content, { offsetMs: opts.offsetMs });
  if (parsed.length > 0) {
    await db
      .insert(characterSightings)
      .values(parsed.map((s) => ({
        serverId: opts.serverId, rptFileId: opts.rptFileId, lineIndex: s.lineIndex,
        uid: s.uid, gamertag: s.gamertag, charId: s.charId, playerDbId: s.playerDbId,
        kind: s.kind, characterClass: s.characterClass, classSource: s.classSource,
        x: s.x, y: s.y, z: s.z, observedAt: s.observedAt,
      })))
      .onConflictDoNothing();
  }
  const staleMs = opts.charStaleHours * 3600_000;
  for (const s of parsed) await upsertCharacter(db, opts.serverId, s, staleMs);
  return { sightings: parsed.length };
}

/** Rollup: match the (serverId, charId) epoch by uid + a stale window; else start a new epoch.
 *  Backfills the class when any sighting resolves it (charID inheritance). */
async function upsertCharacter(db: Database, serverId: number, s: CharacterSighting, staleMs: number): Promise<void> {
  const rows = await db
    .select()
    .from(characters)
    .where(and(eq(characters.serverId, serverId), eq(characters.charId, s.charId), eq(characters.uid, s.uid)))
    .orderBy(desc(characters.lastSeenAt));
  const t = s.observedAt.getTime();
  const match = rows.find((r) => t >= r.firstSeenAt.getTime() - staleMs && t <= r.lastSeenAt.getTime() + staleMs);

  if (match) {
    const set: Record<string, unknown> = {};
    if (t > match.lastSeenAt.getTime()) set.lastSeenAt = s.observedAt;
    if (!match.characterClass && s.characterClass) set.characterClass = s.characterClass;
    if (Object.keys(set).length > 0) await db.update(characters).set(set).where(eq(characters.id, match.id));
  } else {
    await db
      .insert(characters)
      .values({ serverId, charId: s.charId, uid: s.uid, characterClass: s.characterClass, firstSeenAt: s.observedAt, lastSeenAt: s.observedAt })
      .onConflictDoNothing();
  }
}
