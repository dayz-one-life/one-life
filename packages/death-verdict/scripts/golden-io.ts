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
  /** Everyone else the reference names for the operator: who, as what, how surely. */
  contributors: { id: string; role: string; confidence: string }[];
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
  contributors: { id: string; role: string; confidence: string }[]; flags: string[]; death_lines: { ref: string; role: string }[]; utc: string;
}

export const parseRef = (s: string): LineRef => {
  const [f, l] = s.split(":");
  return { admFileId: Number(f), lineIndex: Number(l) };
};
/** A golden uid, `<project>-<server>-<file>-<line>`, -> the primary line it names. */
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
        contributors: r.contributors.map((c) => ({ id: c.id, role: c.role, confidence: c.confidence })), flags: r.flags,
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
    /** The evidence half of the trap-kill bar per trap death, reviewed (`tools/make-credits-expected.mts`). */
    creditsExpected: join(gold, "credits.expected.json"),
    /** Spawn Water/Energy per server over time, exported from the reference run. */
    spawnBaselines: join(gold, "spawn_baselines.json"),
    /** Permanent, signed-off differences from the reference. Must exist; expected empty. */
    exceptions: join(gold, "EXCEPTIONS.md"),
    records: join(corpus, "deaths.jsonl.gz"),
    /** The uids the Clan Wars rule fixtures were built from, one per line. */
    cwUids: join(gold, "cw-rules.uids.txt"),
    /** Written by the golden reporter when a WHOLE run passed, read by `write-attest.ts`. Never committed. */
    lastRun: join(gold, ".golden-run.json"),
    /** The key the attestation is signed with. ⚠️ Private: it lives with the golden data and nowhere else. */
    attestKey: join(gold, "attest-key", "ed25519-private.pem"),
  };
}

/**
 * Every private file a golden suite reads its inputs or its ANSWERS from, relative to the golden
 * directory. `corpusHash` covers all of them, so an attestation names exactly the data it was
 * earned on. ⚠️ A suite that starts reading another private file must add it here.
 */
export const GOLDEN_INPUTS: readonly string[] = [
  "classified.jsonl", "known-gaps.json", "parity.expected.json", "context.expected.json.gz", "credits.expected.json", "cw-rules.uids.txt",
  "labels.snapshot.json", "labels.expected.json", "tokens.json", "spawn_baselines.json", "EXCEPTIONS.md",
  "corpus/ol_raw_lines.tsv", "corpus/ol_adm_files.csv", "corpus/ol_servers.csv", "corpus/ol_lives.csv", "corpus/ol_kills.csv",
  "corpus/cw_raw_lines.tsv", "corpus/cw_adm_files.csv",
  "ol/", "cw-rules/",
];

/** The private suites a golden run must have run, by file name. ⚠️ Adding or removing a suite
 *  changes this list, the pinned counts in `test/attest.test.ts`, and needs a fresh golden run. */
export const GOLDEN_SUITES: readonly string[] = [
  "cluster-golden.test.ts", "cluster-seed.test.ts", "context-golden.test.ts", "credits-golden.test.ts", "fixtures-golden.test.ts",
  "golden-labels.test.ts", "golden-parity.test.ts", "log-clock-golden.test.ts", "select-sufficiency.test.ts",
  "stated-golden.test.ts", "tokens-golden.test.ts",
];

export function readFixtures(dir: string): Fixture[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json.gz")).sort()
    .map((f) => JSON.parse(gunzipSync(readFileSync(join(dir, f))).toString("utf8")) as Fixture);
}

export const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");

/** Every `.ts` file under a directory, as sorted paths relative to it. */
function tsFiles(dir: string): string[] {
  const files: string[] = [];
  const walk = (at: string, rel: string) => {
    for (const e of readdirSync(at, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(at, e.name), `${rel}${e.name}/`);
      else if (e.name.endsWith(".ts")) files.push(`${rel}${e.name}`);
    }
  };
  if (existsSync(dir)) walk(dir, "");
  return files.sort();
}

// Line endings are normalised so a checkout with CRLF hashes the same.
const text = (path: string): string => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

/** SHA-256 over the package's source: every `src/**\/*.ts`, by sorted path, path and content. */
export function sourceHash(pkgRoot: string): string {
  const h = createHash("sha256");
  for (const f of tsFiles(join(pkgRoot, "src"))) h.update(`${f}\n`).update(text(join(pkgRoot, "src", f))).update("\0");
  return h.digest("hex");
}

/**
 * SHA-256 over the golden HARNESS: everything that decides what "the golden suites passed" means
 * and is not the classifier itself — the private suites and their helpers
 * (`test/golden-private/**`), the scripts (`scripts/**`), the golden vitest config and the
 * `golden` command of package.json. Gutting a suite, weakening the comparator or dropping the
 * reporter moves it, and the attestation is then no longer valid.
 */
export function harnessHash(pkgRoot: string): string {
  const h = createHash("sha256");
  for (const dir of ["scripts", "test/golden-private"]) {
    for (const f of tsFiles(join(pkgRoot, dir))) h.update(`${dir}/${f}\n`).update(text(join(pkgRoot, dir, f))).update("\0");
  }
  h.update("vitest.golden.config.ts\n").update(text(join(pkgRoot, "vitest.golden.config.ts"))).update("\0");
  const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as { scripts?: Record<string, string> };
  h.update("package.json#scripts.golden\n").update(pkg.scripts?.golden ?? "").update("\0");
  return h.digest("hex");
}

/** The private suite files that exist, by name. */
export const goldenSuiteFiles = (pkgRoot: string): string[] =>
  readdirSync(join(pkgRoot, "test", "golden-private")).filter((f) => f.endsWith(".test.ts")).sort();

/**
 * SHA-256 over the private golden data: every file of `GOLDEN_INPUTS`, by name and content hash
 * (a directory by the name and hash of each fixture in it). A missing file hashes as missing, so
 * removing one moves the hash too. ⚠️ Prints nothing and returns only the digest.
 */
export function corpusHash(gold: string): string {
  const h = createHash("sha256");
  const one = (rel: string) => {
    const path = join(gold, rel);
    h.update(`${rel}\n`).update(existsSync(path) ? sha256(readFileSync(path)) : "missing").update("\0");
  };
  for (const rel of GOLDEN_INPUTS) {
    if (!rel.endsWith("/")) { one(rel); continue; }
    const dir = join(gold, rel);
    const names = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json.gz")).sort() : [];
    h.update(`${rel}\n${names.length}\n`);
    for (const name of names) one(`${rel}${name}`);
  }
  return h.digest("hex");
}
