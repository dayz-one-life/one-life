import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { parseDeath } from "@onelife/adm-parser";
import { indexOf, selectContextLines, stampCorpus } from "../src/index.js";
import { loadCorpora, readClassified, refOfUid, type Fixture, type Project } from "./golden-io.js";

/**
 * Builds the golden fixtures: for each death the reference classified, the lines
 * `selectContextLines` picks for it, the lines it can be seeded from, and the reference's answer.
 *
 *   pnpm --filter @onelife/death-verdict exec tsx scripts/build-golden.ts \
 *     --raw "$DEATH_GOLDEN_DIR/corpus/ol_raw_lines.tsv" --files "$DEATH_GOLDEN_DIR/corpus/ol_adm_files.csv" \
 *     --servers "$DEATH_GOLDEN_DIR/corpus/ol_servers.csv" --golden "$DEATH_GOLDEN_DIR/classified.jsonl" \
 *     --project OL --out "$DEATH_GOLDEN_DIR/ol"
 *
 * With `--project CW --uids <a,b,c>` it writes only those deaths (the rule fixtures).
 *
 * ⚠️ PRIVATE DATA. It reads and writes only under `$DEATH_GOLDEN_DIR`, refuses any other output
 * directory, and prints counts and sizes, never a name, an id, a uid or a line. The fixtures hold
 * real players' lines and must never be copied into this repository.
 */
function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}
const need = (name: string): string => {
  const v = arg(name);
  if (!v) { console.error(`build-golden: --${name} is required`); process.exit(2); }
  return v;
};

const gold = process.env.DEATH_GOLDEN_DIR;
if (!gold) { console.error("build-golden: DEATH_GOLDEN_DIR is not set"); process.exit(2); }
const out = resolve(need("out"));
if (!(out + "/").startsWith(resolve(gold) + "/")) { console.error("build-golden: --out must be inside DEATH_GOLDEN_DIR"); process.exit(2); }
const project = need("project") as Project;
if (project !== "OL" && project !== "CW") { console.error("build-golden: --project is OL or CW"); process.exit(2); }
const only = arg("uids") ? new Set(arg("uids")!.split(",").map((s) => s.trim()).filter(Boolean)) : null;
if (project === "CW" && !only) { console.error("build-golden: --project CW needs --uids"); process.exit(2); }

const corpora = loadCorpora({ raw: need("raw"), files: need("files"), servers: arg("servers"), project });
const rows = readClassified(need("golden"), project).filter((r) => !only || only.has(r.uid));
if (only && rows.length !== only.size) { console.error(`build-golden: ${only.size - rows.length} of the --uids are not in the golden file`); process.exit(1); }

mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) if (f.endsWith(".json.gz")) rmSync(join(out, f));

let bytes = 0, lines = 0, seeds = 0;
for (const row of rows) {
  const corpus = corpora.get(row.serverId);
  if (!corpus) throw new Error("build-golden: a golden death names a server the export does not hold");
  const input = selectContextLines(corpus, refOfUid(row.uid));
  const S = indexOf(stampCorpus(corpus));
  const seedRefs = input.cluster.lines.map((l) => l.ref).filter((ref) => parseDeath(S.line(ref)!.text) != null);
  const fixture: Fixture = { uid: row.uid, project, ...input, seedRefs, expected: row.expected };
  // mtime 0 keeps the archive byte-stable from run to run.
  const gz = gzipSync(Buffer.from(JSON.stringify(fixture)), { level: 9 });
  gz.writeUInt32LE(0, 4);
  writeFileSync(join(out, `${row.uid}.json.gz`), gz);
  bytes += gz.length; seeds += seedRefs.length;
  for (const f of input.files) lines += f.lines.length;
}
const onDisk = readdirSync(out).reduce((n, f) => n + statSync(join(out, f)).size, 0);
console.log(`build-golden: ${rows.length} fixtures, ${lines} lines, ${seeds} seed lines, ${(bytes / 1e6).toFixed(1)} MB compressed (${(onDisk / 1e6).toFixed(1)} MB in the directory)`);
