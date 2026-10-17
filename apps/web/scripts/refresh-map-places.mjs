#!/usr/bin/env node
//
// apps/web/scripts/refresh-map-places.mjs — regenerates packages/client-logic/src/map-places.json from
// DZMap's upstream location data (the same source as the mirrored tiles).
//
// NOTE: apps/newsdesk/src/map-places.json is a vendored copy for the obituary no-place
// validator — re-copy it whenever this file is regenerated.
//
// Run by hand after a DayZ terrain update, on the same cadence as deploy/mirror-tiles.sh
// — place names change with the game, not with our releases:
//
//   node apps/web/scripts/refresh-map-places.mjs                       # pinned versions
//   node apps/web/scripts/refresh-map-places.mjs chernarusplus=1.30-0  # override one map
//
// Each map carries its own version segment: the iteration counter is per map upstream
// (on 2026-10-16 chernarusplus was 1.30-0 while nasdara was 1.30-6), so one shared
// version would 0-byte at least one of them.
//
// ⚠️ FINDING THE VERSION SEGMENT. The URL is
// `https://static.xam.nu/dayz/json/<map>/<version>-<iteration>.json` and the host answers
// EVERY path with `200` and a zero-byte body — a wrong version looks like a successful
// fetch of an empty file, not a 404. That is why `assertNonEmpty` below is not paranoia.
// The live pair is embedded in dayz.xam.nu's own JS bundle; to re-derive it:
//
//   curl -s https://dayz.xam.nu/ | grep -oE '/js/bundle[^"]+'      # find the bundle
//   curl -s https://dayz.xam.nu/<bundle> | grep -o '"chernarusplus":{"v":"[^"]*","i":[0-9]*}'
//
// which yields e.g. {"v":"1.29","i":7} ⇒ version segment `1.29-7`. Swap `chernarusplus`
// for the publishing name of the map you are bumping.
//
// NOTE the map key mismatch: Livonia's data is published under `livonia`, while our
// `servers.map` codename (and the tile directory) is `enoch`. The output is keyed by OUR
// codename, so nothing downstream has to know about this.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// [our servers.map codename, DZMap's publishing name, version segment]
const MAPS = [
  ["chernarusplus", "chernarusplus", "1.29-7"],
  ["enoch", "livonia", "1.29-7"],
  ["sakhal", "sakhal", "1.29-7"],
  // Nasdara is xam.nu's "very early" upload; its tilev (26.10.15) matches deploy/dzmap.yaml.
  ["nasdara", "nasdara", "1.30-6"],
];
const OVERRIDES = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [codename, version] = arg.split("=");
    if (!version || !MAPS.some(([c]) => c === codename)) {
      throw new Error(`bad argument "${arg}" — expected <codename>=<version>, codename one of ${MAPS.map(([c]) => c).join(", ")}`);
    }
    return [codename, version];
  }),
);

/** Lowercase source name → display casing. Every word, including after a `(` or `-`. */
function titleCase(raw) {
  // U+0307 COMBINING DOT ABOVE rides on the `i` of `i̇turup` in the source data; upper-casing
  // that sequence produces a stray floating dot, so it is dropped before casing.
  const clean = raw.normalize("NFC").replace(/̇/g, "");
  return clean
    .replace(/(^|[\s(\-])(\p{Ll})/gu, (_m, lead, ch) => lead + ch.toUpperCase())
    // Nasdara's Persian ezafe stays lowercase: `bagh-e mir` ⇒ "Bagh-e Mir", not "Bagh-E Mir".
    .replace(/-E(?=\s|$)/g, "-e")
    // Roman numerals and military/Soviet acronyms are all-caps words, not names.
    .replace(/\b(Ii|Iii|Iv|Cop|Fob|Okb|Nii)\b/g, (w) => w.toUpperCase());
}

// static.xam.nu's bot filter 403s Node's default fetch headers (a 403 is NOT a missing file);
// the same browser UA + Referer pair deploy/mirror-tiles.sh uses gets through.
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  Referer: "https://dayz.xam.nu/",
};

function assertNonEmpty(text, url, version) {
  // static.xam.nu answers an unknown path with 200 + an empty body, so a stale version
  // segment would otherwise silently write a file with zero places for that map.
  if (text.trim().length === 0) {
    throw new Error(`empty body from ${url} — the version segment "${version}" is probably stale (see the header comment)`);
  }
}

const out = {};
for (const [codename, upstream, pinned] of MAPS) {
  const version = OVERRIDES[codename] ?? pinned;
  const url = `https://static.xam.nu/dayz/json/${upstream}/${version}.json`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const text = await res.text();
  assertNonEmpty(text, url, version);
  const locations = JSON.parse(text).markers?.locations;
  if (!Array.isArray(locations) || locations.length === 0) {
    throw new Error(`${url} has no markers.locations array`);
  }
  // `p` is ALREADY a Leaflet CRS.Simple latLng on the same zoom-6 pyramid our tiles use —
  // it is passed through untouched, never re-projected. `s[0]` is the latin-script name
  // (later entries are cyrillic and transliterated search aliases we do not need).
  out[codename] = locations
    .map((l) => ({ kind: l.w, lat: l.p[0], lng: l.p[1], name: titleCase(l.s[0]) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  console.log(`${codename}: ${out[codename].length} places`);
}

const dest = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "packages", "client-logic", "src", "map-places.json");
await writeFile(dest, JSON.stringify(out, null, 1) + "\n");
console.log(`wrote ${dest}`);
