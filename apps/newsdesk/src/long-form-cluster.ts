/** INTERNAL to the Long Form slice — carries coordinates. Never returned from long-form-targets.ts. */
export interface DeathCandidate {
  lifeId: number; serverId: number; gamertag: string;
  map: string; mapSlug: string | null; lifeNumber: number;
  lifeStartedAt: Date; endedAt: Date; deathCause: string | null;
  x: number; y: number; fixAt: Date;
}
export interface LongFormSubject {
  lifeId: number; serverId: number; gamertag: string;
  map: string; mapSlug: string | null; lifeNumber: number;
  lifeStartedAt: Date; endedAt: Date; deathCause: string | null;
}
export interface LongFormCluster {
  serverId: number; map: string; mapSlug: string | null;
  earliestDeathAt: Date; primary: LongFormSubject;
  subjects: LongFormSubject[];   // includes primary; sorted by gamertag asc
  naturalKey: string;
}

const metres = (a: DeathCandidate, b: DeathCandidate) => Math.hypot(a.x - b.x, a.y - b.y);
const seconds = (a: DeathCandidate, b: DeathCandidate) =>
  Math.abs(a.endedAt.getTime() - b.endedAt.getTime()) / 1000;

const byTag = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Timestamps serialize as toISOString() (UTC, ms precision); gamertags appear VERBATIM as stored
 *  in `players`, never lowercased (spec §6). A gamertag containing '+' would make the key
 *  ambiguous — the observed corpus has none (asserted in long-form-cluster.test.ts) and escaping
 *  is deliberately NOT done, because it would change the key format for every future article. */
export function longFormNaturalKey(serverId: number, earliestDeathAt: Date, gamertags: string[]): string {
  return `long_form:${serverId}:${earliestDeathAt.toISOString()}:${[...gamertags].sort(byTag).join("+")}`;
}

const strip = (c: DeathCandidate): LongFormSubject => ({
  lifeId: c.lifeId, serverId: c.serverId, gamertag: c.gamertag, map: c.map,
  mapSlug: c.mapSlug, lifeNumber: c.lifeNumber, lifeStartedAt: c.lifeStartedAt,
  endedAt: c.endedAt, deathCause: c.deathCause,
});

export function buildLongFormClusters(
  candidates: DeathCandidate[],
  opts: { windowSeconds: number; radiusMeters: number },
): LongFormCluster[] {
  const out: LongFormCluster[] = [];
  const byServer = new Map<number, DeathCandidate[]>();
  for (const c of candidates) {
    const bucket = byServer.get(c.serverId);
    if (bucket) bucket.push(c); else byServer.set(c.serverId, [c]);
  }

  for (const [serverId, bucket] of [...byServer.entries()].sort((a, b) => a[0] - b[0])) {
    // Sort by (endedAt, gamertag). NEVER by lives.id — it is not stable across a projection
    // rebuild, and both natural_key and the primary choice depend on this ordering (spec §4.2).
    const rows = [...bucket].sort(
      (a, b) => a.endedAt.getTime() - b.endedAt.getTime() || byTag(a.gamertag, b.gamertag));
    const claimed = new Set<number>();

    for (let i = 0; i < rows.length; i++) {
      if (claimed.has(i)) continue;
      const members = [i];
      for (let j = i + 1; j < rows.length; j++) {
        if (claimed.has(j)) continue;
        // A clique, not a chain: j must satisfy BOTH thresholds against EVERY current member,
        // not merely against the seed. With A~B and B~C but not A~C, chaining yields {A,B,C};
        // this yields {A,B} and lets C seed its own (discarded) singleton. Thresholds are
        // INCLUSIVE — exactly 180.000s / 100.000m is in, 180.001s is out.
        //
        // Admission in sorted order is GREEDY and is not guaranteed to find the MAXIMUM clique;
        // it finds *a* maximal one deterministically. Determinism is the requirement — the same
        // input must always yield the same members and therefore the same natural_key. Do not
        // "fix" this into a maximum-clique search; that would make membership order-sensitive.
        const ok = members.every((m) =>
          seconds(rows[m]!, rows[j]!) <= opts.windowSeconds &&
          metres(rows[m]!, rows[j]!) <= opts.radiusMeters);
        if (ok) members.push(j);
      }
      for (const m of members) claimed.add(m);   // a death belongs to at most one cluster, ever
      if (members.length < 2) continue;

      const subjects = members.map((m) => strip(rows[m]!)).sort((a, b) => byTag(a.gamertag, b.gamertag));
      // Computed explicitly rather than relying on `subjects[0]` or the seed, so a future change
      // to seed order cannot silently change which subject is primary.
      const primary = [...subjects].sort(
        (a, b) => a.endedAt.getTime() - b.endedAt.getTime() || byTag(a.gamertag, b.gamertag))[0]!;
      out.push({
        serverId, map: primary.map, mapSlug: primary.mapSlug,
        earliestDeathAt: primary.endedAt, primary, subjects,
        naturalKey: longFormNaturalKey(serverId, primary.endedAt, subjects.map((s) => s.gamertag)),
      });
    }
  }
  return out;
}
