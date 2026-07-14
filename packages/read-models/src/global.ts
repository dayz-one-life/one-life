import type { Database } from "@onelife/db";
import { servers } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getRoster, type RosterEntry } from "./queries.js";
import { getLeaderboard, type Leaderboard, type LeaderRow } from "./leaderboards.js";

export type GlobalRosterEntry = RosterEntry & { map: string; slug: string };
export type GlobalLeaderRow = LeaderRow & { map: string; slug: string };

export async function getGlobalRoster(db: Database, now: Date): Promise<GlobalRosterEntry[]> {
  const active = await db.select().from(servers).where(eq(servers.active, true));
  const out: GlobalRosterEntry[] = [];
  for (const s of active) {
    if (!s.slug) continue;
    const rows = await getRoster(db, s.id, now);
    for (const r of rows) out.push({ ...r, map: s.map, slug: s.slug });
  }
  return out.sort((a, b) => b.sessionSeconds - a.sessionSeconds);
}

export async function getGlobalBoard(db: Database, board: Leaderboard, now: Date, limit: number): Promise<GlobalLeaderRow[]> {
  const active = await db.select().from(servers).where(eq(servers.active, true));
  const merged: GlobalLeaderRow[] = [];
  for (const s of active) {
    if (!s.slug) continue;
    const rows = await getLeaderboard(db, s.id, board, now, limit);
    for (const r of rows) merged.push({ ...r, map: s.map, slug: s.slug });
  }
  return merged.sort((a, b) => b.value - a.value).slice(0, limit);
}
