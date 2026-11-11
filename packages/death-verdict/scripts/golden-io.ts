import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { ContextInput, LineRef, ServerCorpus, ZoneRule } from "../src/index.js";

/**
 * Reading the PRIVATE golden data: the exported raw lines, the reference answers and the
 * per-death fixtures. Shared by the fixture builder and the private suites.
 *
 * ⚠️ Everything read here is real player data. It lives only under `$DEATH_GOLDEN_DIR`; nothing
 * here may print a name, an id, a uid, a position or a line, and nothing may be written outside
 * that directory.
 */

export type Project = "OL" | "CW";

/** What the reference classifier answered for one death: the fields the parity test compares. */
export interface Expected {
  cause: string;
  confidence: string;
  rule: string;
  mechanismStated: boolean;
  upstreamCause: string | null;
  upstreamConfidence: string | null;
  coCauses: string[];
  weaponOrObject: string | null;
  attributedTo: { role: string; id: string; confidence: string } | null;
  contributorIds: string[];
  flags: string[];
  deathLines: { ref: LineRef; role: string }[];
  utc: string;
}

/** One golden fixture: everything selected for a death, the lines it can be seeded from, and the answer. */
export interface Fixture extends ContextInput {
  uid: string;
  project: Project;
  /** Every line of the cluster the event parser accepts as a death. */
  seedRefs: LineRef[];
  expected: Expected;
}

interface ClassifiedRow {
  uid: string; project: Project; server_id: number; cause: string; confidence: string; rule: string;
  mechanism_stated: boolean; upstream_cause: string | null; upstream_confidence: string | null; co_causes: string[];
  weapon_or_object: string | null; attributed_to: { role: string; id: string; confidence: string } | null;
  contributors: { id: string }[]; flags: string[]; death_lines: { ref: string; role: string }[]; utc: string;
}

export const parseRef = (s: string): LineRef => {
  const [f, l] = s.split(":");
  return { admFileId: Number(f), lineIndex: Number(l) };
};
/** `OL-3-1234-56` (project, server, file, line) -> the primary line it names. */
export const refOfUid = (uid: string): LineRef => {
  const p = uid.split("-");
  return { admFileId: Number(p[2]), lineIndex: Number(p[3]) };
};

export function readClassified(path: string, project: Project): { uid: string; serverId: number; expected: Expected }[] {
  const out: { uid: string; serverId: number; expected: Expected }[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    const r = JSON.parse(line) as ClassifiedRow;
    if (r.project !== project) continue;
    out.push({
      uid: r.uid, serverId: r.server_id,
      expected: {
        cause: r.cause, confidence: r.confidence, rule: r.rule, mechanismStated: r.mechanism_stated,
        upstreamCause: r.upstream_cause, upstreamConfidence: r.upstream_confidence, coCauses: r.co_causes,
        weaponOrObject: r.weapon_or_object,
        attributedTo: r.attributed_to ? { role: r.attributed_to.role, id: r.attributed_to.id, confidence: r.attributed_to.confidence } : null,
        contributorIds: r.contributors.map((c) => c.id), flags: r.flags,
        deathLines: r.death_lines.map((d) => ({ ref: parseRef(d.ref), role: d.role })), utc: r.utc,
      },
    });
  }
  return out;
}

/** A minimal CSV reader for the exports: quoted fields, doubled quotes. */
function readCsv(path: string): Record<string, string>[] {
  const text = readFileSync(path, "utf8");
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

/** The Clan Wars host keeps Pacific time. Its server id collides with a One Life one, so it is named here. */
const CW_ZONE: ZoneRule = { mode: "zone", zone: "America/Los_Angeles" };

/**
 * Loads an exported project as one corpus per server. The One Life export has a stored-time
 * column the log clock does not use; the Clan Wars one has none.
 */
export function loadCorpora(opts: { raw: string; files: string; servers?: string | null; project: Project }): Map<number, ServerCorpus> {
  const names = new Map<number, string>();
  for (const r of readCsv(opts.files)) names.set(Number(r.id), r.name || r.filename || "");
  const maps = new Map<number, string>();
  if (opts.servers) for (const r of readCsv(opts.servers)) maps.set(Number(r.id), r.map ?? "");
  const cols = opts.project === "OL" ? 4 : 3;
  const byFile = new Map<string, { serverId: number; admFileId: number; lines: [number, string][] }>();
  const text = readFileSync(opts.raw, "utf8");
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end < 0) end = text.length;
    let raw = text.slice(start, end);
    start = end + 1;
    if (raw.endsWith("\r")) raw = raw.slice(0, -1);
    if (!raw) continue;
    const parts: string[] = [];
    let at = 0;
    for (let i = 0; i < cols; i++) { const t = raw.indexOf("\t", at); parts.push(raw.slice(at, t)); at = t + 1; }
    const serverId = Number(parts[0]), admFileId = Number(parts[1]), lineIndex = Number(parts[2]);
    const key = `${serverId}|${admFileId}`;
    let f = byFile.get(key);
    if (!f) { f = { serverId, admFileId, lines: [] }; byFile.set(key, f); }
    f.lines.push([lineIndex, raw.slice(at)]);
  }
  const out = new Map<number, ServerCorpus>();
  for (const f of byFile.values()) {
    let c = out.get(f.serverId);
    if (!c) {
      c = { serverId: f.serverId, map: maps.get(f.serverId) ?? null, files: [] };
      if (opts.project === "CW") c.zone = CW_ZONE;
      out.set(f.serverId, c);
    }
    c.files.push({ admFileId: f.admFileId, name: names.get(f.admFileId) ?? "", lines: f.lines });
  }
  return out;
}

export function goldenLayout(gold: string) {
  const corpus = join(gold, "corpus");
  return {
    classified: join(gold, "classified.jsonl"),
    ol: { raw: join(corpus, "ol_raw_lines.tsv"), files: join(corpus, "ol_adm_files.csv"), servers: join(corpus, "ol_servers.csv"), project: "OL" as const },
    cw: { raw: join(corpus, "cw_raw_lines.tsv"), files: join(corpus, "cw_adm_files.csv"), servers: null, project: "CW" as const },
    olFixtures: join(gold, "ol"),
    cwFixtures: join(gold, "cw-rules"),
    knownGaps: join(gold, "known-gaps.json"),
    parityExpected: join(gold, "parity.expected.json"),
    contextExpected: join(gold, "context.expected.json.gz"),
    records: join(corpus, "deaths.jsonl.gz"),
    /** Written by the parity suite, read by `write-attest.ts`. Never committed. */
    lastRun: join(gold, ".golden-run.json"),
  };
}

export function readFixtures(dir: string): Fixture[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json.gz")).sort()
    .map((f) => JSON.parse(gunzipSync(readFileSync(join(dir, f))).toString("utf8")) as Fixture);
}

export const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");

/** SHA-256 over the package's source: every `src/**\/*.ts`, by sorted path, path and content. */
export function sourceHash(pkgRoot: string): string {
  const files: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (e.isDirectory()) walk(join(dir, e.name), `${rel}${e.name}/`);
      else if (e.name.endsWith(".ts")) files.push(`${rel}${e.name}`);
    }
  };
  walk(join(pkgRoot, "src"), "");
  files.sort();
  const h = createHash("sha256");
  // Line endings are normalised so a checkout with CRLF hashes the same.
  for (const f of files) h.update(`${f}\n`).update(readFileSync(join(pkgRoot, "src", f), "utf8").replace(/\r\n/g, "\n")).update("\0");
  return h.digest("hex");
}
