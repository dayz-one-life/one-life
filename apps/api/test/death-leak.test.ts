import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { servers, players, lives, sessions, kills, deathVerdicts, articles, bans, playerGamertags } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { buildApp } from "../src/app.js";

/**
 * The death leak guard (death-verdict spec 2.3, 7, 8.2). The stored verdict holds names and markers
 * that must never be served: a placer who failed the credit bar, a contributor, the logout marker,
 * rule ids, raw class names, evidence. This seeds them all — every INTERNAL column carries a marker
 * string — and reads every route that returns a death or a kill.
 *
 * `/me` returns the session's user and accounts only; the ban card a signed-in player sees is the
 * standing card of `GET /players/:gt`, read here with an active ban.
 *
 * ⚠️ Invented players, lives and verdicts only.
 */
const { db, sql } = getTestDb();
const app = buildApp(db);
const svc = Math.floor(Math.random() * 1e8) + 55e7;
const SLUG = `leak-${svc}`;
const T0 = new Date("2026-07-01T10:00:00Z"); // in the past: an open life's kill window ends at now
const at = (m: number) => new Date(T0.getTime() + m * 60_000);
const NAMES = {
  credited: `Credited Victim ${svc}`, refused: `Refused Victim ${svc}`, logout: `Logout Victim ${svc}`,
  placer: `Placer Person ${svc}`, refusedPlacer: `Refused Person ${svc}`, helper: `Helper Person ${svc}`,
};
const INTERNAL = ["INTERNAL_OBJECT_TEXT", "INTERNAL_OBJECT_CLASS", "INTERNAL_RULE", "INTERNAL_ATTR_ID", "INTERNAL_FLAG", "INTERNAL_NOTE"];
const LOGOUT_WORDS = /logout_under_attack|unconscious_logout|respawn_while_unconscious|restrained_logout|logged out|combat log/i;
const FORBIDDEN_KEY = /^(attr.*|evidence|rule|objectText|object_text|objectClass|upstream.*|placement.*|placedAt|placed_at|flags)$/;

let sid: number;
const pid: Record<string, number> = {};
const lid: Record<string, number> = {};

async function verdict(lifeId: number, v: Record<string, unknown>) {
  await db.insert(deathVerdicts).values({
    lifeId, classifierVersion: 2, settledBy: "file", deathFileId: 1, deathLineIndex: lifeId, deathAt: at(0),
    mechanismStated: true, objectClass: "INTERNAL_OBJECT_CLASS", objectText: "INTERNAL_OBJECT_TEXT", rule: "INTERNAL_RULE",
    attrDayzId: "INTERNAL_ATTR_ID", ...v,
  } as typeof deathVerdicts.$inferInsert);
}

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "leak", map: "chernarusplus", slug: SLUG, active: true }).returning();
  sid = s!.id;
  for (const [k, name] of Object.entries(NAMES)) {
    const [p] = await db.insert(players).values({ gamertag: name, firstSeenAt: T0, lastSeenAt: at(1) }).returning();
    pid[k] = Number(p!.id);
    await db.insert(playerGamertags).values({ playerId: pid[k]!, gamertag: name, firstSeenAt: T0, lastSeenAt: T0 });
  }
  // the placer: an open 60-second life, qualified only by the trap kill
  const [pl] = await db.insert(lives).values({ serverId: sid, playerId: pid.placer!, lifeNumber: 1, startedAt: T0, endedAt: null, playtimeSeconds: 60 }).returning();
  lid.placer = Number(pl!.id);
  await db.insert(sessions).values({ serverId: sid, playerId: pid.placer!, lifeId: lid.placer, connectedAt: T0, disconnectedAt: at(1), durationSeconds: 60, closeReason: "death" });
  // three dead victims, each a life that counts on its own
  for (const [k, cause] of [["credited", "explosion"], ["refused", "explosion"], ["logout", "died"]] as const) {
    const [l] = await db.insert(lives).values({
      serverId: sid, playerId: pid[k]!, lifeNumber: 1, startedAt: at(100), endedAt: at(200), playtimeSeconds: 3000, deathCause: cause,
    }).returning();
    lid[k] = Number(l!.id);
    await db.insert(sessions).values({ serverId: sid, playerId: pid[k]!, lifeId: lid[k]!, connectedAt: at(150), disconnectedAt: at(200), durationSeconds: 3000, closeReason: "death" });
  }
  const contributors = [{ role: "contributor", dayzId: "INTERNAL_ATTR_ID", gamertag: NAMES.helper, confidence: "strong" }];
  await verdict(lid.credited!, {
    cause: "explosive_trap", confidence: "definitive", objectKey: "m67_grenade", attrRole: "trap_owner", attrBasis: "placement",
    attrGamertag: NAMES.placer, attrConfidence: "strong",
    evidence: { flags: ["INTERNAL_FLAG"], notes: ["INTERNAL_NOTE"], contributors, credit: { outcome: "credited", placerDayzId: "INTERNAL_ATTR_ID", placement: { admFileId: 1, lineIndex: 2 }, distanceM: 1.5, flags: ["INTERNAL_FLAG"] } },
  });
  await verdict(lid.refused!, {
    cause: "explosive_trap", confidence: "definitive", objectKey: "m67_grenade", attrRole: "trap_owner", attrBasis: "placement",
    attrGamertag: NAMES.refusedPlacer, attrConfidence: "strong",
    evidence: { flags: ["INTERNAL_FLAG"], notes: [`${NAMES.refusedPlacer} placed it`], contributors, credit: { outcome: "refused", refusedBy: 7 } },
  });
  await verdict(lid.logout!, {
    cause: "logout_under_attack", confidence: "definitive", upstreamCause: "infected", upstreamConfidence: "strong",
    evidence: { flags: ["INTERNAL_FLAG", "logout_under_attack"], notes: ["logged out under attack"], contributors },
  });
  // the credited death's trap kill, as the sweep writes it
  await db.insert(kills).values({
    serverId: sid, killerGamertag: NAMES.placer, killerPlayerId: pid.placer!, victimGamertag: NAMES.credited, victimPlayerId: pid.credited!,
    victimLifeId: lid.credited!, weapon: "Tripwire", distance: null, occurredAt: at(200), basis: "trap_placement", creditSource: "classifier",
  });
  // an active ban on the credited victim (the ban card), and an obituary for each victim
  await db.insert(bans).values({ serverId: sid, gamertag: NAMES.credited, lifeStartedAt: at(100), reason: "qualified_death", qualifiedBy: "playtime",
    bannedAt: at(200), expiresAt: new Date("2099-01-01T00:00:00Z"), status: "applied", dryRun: false });
  for (const k of ["credited", "refused", "logout"] as const) {
    await db.insert(articles).values({
      kind: "obituary", status: "published", slug: `leak-${svc}-${k}`, serverId: sid, gamertag: NAMES[k], map: "chernarusplus", mapSlug: SLUG,
      lifeNumber: 1, lifeStartedAt: at(100), deathAt: at(200), headline: `H ${k}`, lede: "L", body: "B",
      tags: ["Obituaries", "Chernarus", "Unknown"], cause: "explosion", promptVersion: "obituary-v3.1", facts: { sessions: 1 },
    });
  }
});
afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, sid));
  await db.delete(bans).where(eq(bans.serverId, sid));
  await db.delete(kills).where(eq(kills.serverId, sid));
  await db.delete(deathVerdicts).where(inArray(deathVerdicts.lifeId, Object.values(lid)));
  await db.delete(sessions).where(eq(sessions.serverId, sid));
  await db.delete(lives).where(eq(lives.serverId, sid));
  await db.delete(playerGamertags).where(inArray(playerGamertags.playerId, Object.values(pid)));
  await db.delete(players).where(inArray(players.id, Object.values(pid)));
  await db.delete(servers).where(eq(servers.id, sid));
  await sql.end();
});

const enc = encodeURIComponent;
/** Every route that returns a death or a kill, for the three victims (not the placer's own pages,
 *  where his name is the subject). */
function victimRoutes(): string[] {
  const out: string[] = [];
  for (const k of ["credited", "refused", "logout"] as const) {
    const gt = enc(NAMES[k]);
    out.push(`/players/${gt}`, `/players/${gt}/${SLUG}/lives/1`, `/servers/${sid}/lives/${lid[k]}`,
      `/servers/${sid}/players/${gt}`, `/servers/${sid}/players/${gt}/lives`, `/obituaries/leak-${svc}-${k}`);
  }
  out.push("/obituaries?page=1");
  return out;
}
function feedRoutes(): string[] {
  return [`/servers/${sid}/kills`, ...["alive-longest", "alltime-longest", "most-kills", "longest-killstreak", "longest-kills"]
    .map((b) => `/servers/${sid}/leaderboards/${b}`)];
}
async function get(url: string): Promise<unknown> {
  const res = await app.inject({ method: "GET", url });
  expect(res.statusCode, url).toBe(200);
  return res.json();
}

type Hit = { path: string[]; parent: Record<string, unknown> };
/** Every string value containing `needle`, with the path of keys that led to it. */
function find(v: unknown, needle: string, path: string[] = [], parent: Record<string, unknown> = {}, out: Hit[] = []): Hit[] {
  if (typeof v === "string") { if (v.includes(needle)) out.push({ path, parent }); }
  else if (Array.isArray(v)) v.forEach((x, i) => find(x, needle, [...path, String(i)], parent, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) find(x, needle, [...path, k], v as Record<string, unknown>, out);
  return out;
}
function keysOf(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.push(k); keysOf(x, out); }
  return out;
}
function objectsWith(v: unknown, key: string, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(v)) v.forEach((x) => objectsWith(x, key, out));
  else if (v && typeof v === "object") {
    if (key in v) out.push(v as Record<string, unknown>);
    for (const x of Object.values(v)) objectsWith(x, key, out);
  }
  return out;
}

describe("the death leak guard", () => {
  it("Refused Person and Helper Person appear nowhere", async () => {
    for (const url of [...victimRoutes(), ...feedRoutes(), `/players/${enc(NAMES.placer)}`]) {
      const body = JSON.stringify(await get(url));
      expect(body, url).not.toContain(NAMES.refusedPlacer);
      expect(body, url).not.toContain(NAMES.helper);
    }
  });

  it("Placer Person appears only as killerGamertag on the trap_placement row, on boards that count that row, and inside the victim's credit", async () => {
    for (const url of [...victimRoutes(), ...feedRoutes()]) {
      const body = await get(url);
      for (const h of find(body, NAMES.placer)) {
        const key = h.path[h.path.length - 1]!;
        const where = `${url} :: ${h.path.join(".")}`;
        if (key === "killerGamertag") expect(h.parent.basis, where).toBe("trap_placement");
        else if (h.path.includes("credit")) expect(key, where).toBe("gamertag");
        else if (key === "sentence" || key === "caption") expect((h.parent.credit as { gamertag?: string } | null)?.gamertag, where).toBe(NAMES.placer);
        else if (url.includes("/leaderboards/")) expect(key, where).toBe("gamertag");
        else expect.fail(`unexpected placement of the placer's name at ${where}`);
      }
    }
    // and the credit is really there on the victim's page
    const life = await get(`/players/${enc(NAMES.credited)}/${SLUG}/lives/1`) as { verdict: { credit: unknown; killerGamertag: unknown } };
    expect(life.verdict.credit).toEqual({ gamertag: NAMES.placer, basis: "trap_placement", device: "tripwire", byOperator: false });
    expect(life.verdict.killerGamertag).toBeNull();
  });

  it("every kill row in every response carries basis", async () => {
    let rows = 0;
    for (const url of [...victimRoutes(), ...feedRoutes(), `/players/${enc(NAMES.placer)}`, `/players/${enc(NAMES.placer)}/${SLUG}/lives/1`]) {
      for (const k of objectsWith(await get(url), "victimGamertag")) {
        rows++;
        expect(k.basis, url).toMatch(/^(kill_line|trap_placement)$/);
      }
    }
    expect(rows).toBeGreaterThan(0);
  });

  it("no key named attr*, evidence, rule, object_text, upstream*, placement*, placed_at or flags; no internal marker", async () => {
    for (const url of [...victimRoutes(), ...feedRoutes()]) {
      const body = await get(url);
      expect(keysOf(body).filter((k) => FORBIDDEN_KEY.test(k)), url).toEqual([]);
      const text = JSON.stringify(body);
      for (const m of INTERNAL) expect(text, url).not.toContain(m);
    }
  });

  it("no logout token", async () => {
    for (const url of victimRoutes()) expect(JSON.stringify(await get(url)), url).not.toMatch(LOGOUT_WORDS);
    // the logout death reads as its upstream cause
    const life = await get(`/players/${enc(NAMES.logout)}/${SLUG}/lives/1`) as { verdict: { label: string; sentence: string } };
    expect(life.verdict).toMatchObject({ label: "Infected", sentence: "Died after an infected attack." });
  });

  it("after a deny override and a sweep pass Placer Person appears nowhere", async () => {
    // What the sweep does on a deny (apps/projector/test/verdict-sweep.test.ts and
    // trap-kill-readers.test.ts prove the sweep does exactly this): the trap row goes.
    await db.delete(kills).where(and(eq(kills.serverId, sid), eq(kills.basis, "trap_placement")));
    for (const url of [...victimRoutes(), ...feedRoutes()]) {
      expect(JSON.stringify(await get(url)), url).not.toContain(NAMES.placer);
    }
    const placer = await get(`/players/${enc(NAMES.placer)}`) as { totals: { kills: number } };
    expect(placer.totals.kills).toBe(0);
  });
});
