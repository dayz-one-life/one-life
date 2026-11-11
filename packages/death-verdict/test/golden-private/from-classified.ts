import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isInternalCause, objectKeyFromText, toPublicDeath,
  type AttributionBasis, type Confidence, type LifeDeathFacts, type PublicDeath, type StoredVerdict, type TrapCredit,
} from "../../src/index.js";

/**
 * Reads the PRIVATE golden answers and turns each One Life death into what `toPublicDeath` is
 * given in production: the stored verdict, the life row's own facts, and the trap credit.
 *
 * Until the TypeScript classifier exists (the next steps), the verdict comes from the reference
 * answers in `classified.jsonl`; this file is the stand-in for the classifier and for the sweep,
 * and is replaced by them. The data it reads is real player data and lives only where
 * `DEATH_GOLDEN_DIR` points:
 *
 *   $DEATH_GOLDEN_DIR/classified.jsonl          the reference verdict per death
 *   $DEATH_GOLDEN_DIR/corpus/ol_lives.csv       the life rows (coarse cause, kill-line killer)
 *   $DEATH_GOLDEN_DIR/corpus/ol_kills.csv       kill-line kills
 *   $DEATH_GOLDEN_DIR/corpus/ol_raw_lines.tsv   server, file, line, time, text
 *
 * ⚠️ Nothing here may print a callsign, an id, a uid or a line. Callers report counts.
 */

export interface GoldenDeath {
  uid: string;
  verdict: StoredVerdict;
  life: LifeDeathFacts;
  credit: TrapCredit | null;
}

/** What the reviewed snapshot holds per death: every string a page prints. */
export interface LabelSnapshotEntry {
  label: string; detail: string | null; sentence: string; caption: string | null; tag: string | null; certainty: string;
}
export const snapshotEntry = (p: PublicDeath): LabelSnapshotEntry => ({
  label: p.label, detail: p.detail, sentence: p.sentence, caption: p.caption, tag: p.tag, certainty: p.certainty,
});
export const publicOf = (d: GoldenDeath): PublicDeath => toPublicDeath(d.verdict, d.life, d.credit);

export function goldenPaths(gold: string) {
  return {
    classified: join(gold, "classified.jsonl"),
    lives: join(gold, "corpus", "ol_lives.csv"),
    kills: join(gold, "corpus", "ol_kills.csv"),
    lines: join(gold, "corpus", "ol_raw_lines.tsv"),
    snapshot: join(gold, "labels.snapshot.json"),
    tokens: join(gold, "tokens.json"),
  };
}
export const goldenInputsReady = (gold: string | undefined): gold is string => {
  if (!gold) return false;
  const p = goldenPaths(gold);
  return [p.classified, p.lives, p.kills, p.lines].every((f) => existsSync(f));
};

interface ClassifiedRow {
  uid: string; project: string; victim_id: string; cause: string; confidence: Confidence; rule: string;
  mechanism_stated: boolean; weapon_or_object: string | null;
  upstream_cause: string | null; upstream_confidence: Confidence | null;
  attributed_to: { role: string; gamertag: string } | null;
  stats: { water: number; energy: number; bleed_sources: number } | null;
  death_lines: { ref: string; role: string }[];
  db_row_id: number;
}

/** RFC 4180, enough for the exports: quoted fields, doubled quotes, newlines inside quotes. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift() ?? [];
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const STARVE_ENERGY_MAX = 1;      // the thresholds the site has always used for the suicide wording
const DEHYDRATE_WATER_MAX = 1;
const HUNTED_WINDOW_S = 120;

const clockOf = (text: string): number | null => {
  const m = /^(\d\d):(\d\d):(\d\d) \| /u.exec(text);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
};

/**
 * The attribution basis the rule that fired would set. Only a rule whose KILL LINE names the
 * player gives a `kill_line*` basis; a name read from a hit line, a placement or proximity does
 * not, whatever the role is called.
 */
function basisOf(r: ClassifiedRow): AttributionBasis | null {
  const role = r.attributed_to?.role;
  if (!role) return null;
  if (role === "killer" && r.rule === "A04") return "kill_line";
  if (role === "grenade_holder" && r.rule === "A03") return "kill_line";
  if (role === "driver" && r.rule === "A01") return "kill_line_driver";
  if (role === "self" && r.rule === "A02") return "kill_line_self";
  if (role === "trap_owner") return "placement";
  return "not_stated";
}

export function loadGoldenDeaths(gold: string): GoldenDeath[] {
  const paths = goldenPaths(gold);
  const classified = readFileSync(paths.classified, "utf8").split("\n").filter(Boolean)
    .map((l) => JSON.parse(l) as ClassifiedRow).filter((r) => r.project === "OL");
  const lives = new Map(parseCsv(readFileSync(paths.lives, "utf8")).map((l) => [Number(l.id), l]));
  const kills = parseCsv(readFileSync(paths.kills, "utf8"));

  // The raw lines, by file, for the one condition the death line does not carry ("hunted").
  const byFile = new Map<string, { index: number; text: string }[]>();
  for (const row of readFileSync(paths.lines, "utf8").split("\n")) {
    if (!row) continue;
    const p = row.split("\t");
    const list = byFile.get(p[1]!) ?? [];
    if (!list.length) byFile.set(p[1]!, list);
    list.push({ index: Number(p[2]), text: p.slice(4).join("\t") });
  }

  /** An infected hit on the victim in the 120 s before the death line. */
  const hunted = (r: ClassifiedRow): boolean => {
    const primary = r.death_lines.find((d) => d.role === "primary") ?? r.death_lines[0];
    if (!primary) return false;
    const [file, line] = primary.ref.split(":");
    const list = byFile.get(file!) ?? [];
    const at = list.findIndex((l) => l.index === Number(line));
    if (at < 0) return false;
    const deathClock = clockOf(list[at]!.text);
    if (deathClock == null) return false;
    const idA = `(id=${r.victim_id} `, idB = `(id=${r.victim_id})`;
    for (let i = at - 1; i >= 0; i--) {
      const text = list[i]!.text;
      const clock = clockOf(text);
      if (clock == null) continue;
      if ((deathClock - clock + 86400) % 86400 > HUNTED_WINDOW_S) break;
      const hit = text.indexOf(" hit by Infected");
      if (hit < 0) continue;
      const head = text.slice(0, hit);
      if (head.includes(idA) || head.includes(idB)) return true;
    }
    return false;
  };

  return classified.map((r) => {
    if (!isInternalCause(r.cause)) throw new Error(`classified.jsonl holds a cause the token list lacks (rule ${r.rule})`);
    const lifeRow = lives.get(r.db_row_id);
    if (!lifeRow) throw new Error(`a golden death has no life row (rule ${r.rule})`);
    const num = (s: string | undefined) => (s == null || s === "" ? null : Number(s));
    const life: LifeDeathFacts = {
      deathCause: lifeRow.death_cause || null, deathByGamertag: lifeRow.death_by_gamertag || null,
      deathWeapon: lifeRow.death_weapon || null, deathDistance: num(lifeRow.death_distance),
    };

    const conditions: string[] = [];
    if (r.stats && r.stats.energy <= STARVE_ENERGY_MAX) conditions.push("starving");
    if (r.stats && r.stats.water <= DEHYDRATE_WATER_MAX) conditions.push("dehydrated");
    if (hunted(r)) conditions.push("hunted");
    if (!conditions.length) conditions.push("healthy");

    const verdict: StoredVerdict = {
      cause: r.cause, confidence: r.confidence, mechanismStated: r.mechanism_stated,
      objectKey: objectKeyFromText(r.weapon_or_object),
      upstream: r.upstream_cause && r.upstream_confidence ? { cause: r.upstream_cause, confidence: r.upstream_confidence } : null,
      attrBasis: basisOf(r), conditions,
    };

    // The half of the credit bar that needs the database: the victim's life must count in its own
    // right — five minutes of play, or a kill-line kill of its own inside the life.
    let credit: TrapCredit | null = null;
    const trap = r.cause === "explosive_trap" || r.cause === "landmine";
    if (trap && r.attributed_to?.role === "trap_owner" && (r.confidence === "definitive" || r.confidence === "strong")) {
      const start = Date.parse(lifeRow.started_at!), end = Date.parse(lifeRow.ended_at!);
      const ownKill = kills.some((k) => k.killer_player_id === lifeRow.player_id && k.server_id === lifeRow.server_id
        && Date.parse(k.occurred_at!) >= start && Date.parse(k.occurred_at!) <= end);
      if (Number(lifeRow.playtime_seconds) >= 300 || ownKill) {
        credit = { gamertag: r.attributed_to.gamertag, device: r.cause === "landmine" ? "land_mine" : "tripwire", byOperator: false };
      }
    }
    return { uid: r.uid, verdict, life, credit };
  });
}
