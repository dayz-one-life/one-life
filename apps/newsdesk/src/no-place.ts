import places from "./map-places.json";
import type { Obituary } from "./prompt.js";

/**
 * THE NO-PLACE RULE's enforcement half. The prompt alone is not trusted: any spatial reference
 * in an obituary is invention (deaths carry no coordinates), so a draft naming one is rejected.
 * Two banned vocabularies:
 *  (a) every real place name from the vendored map-places.json (a copy of the web's list —
 *      re-copy on terrain updates, see refresh-map-places.mjs);
 *  (b) a curated structure/terrain wordlist.
 * Exempt: the map labels/codenames (the one allowed place) and any caller-supplied gamertags
 * (a callsign like "BarnOwl" is identity, not scenery).
 */
export const PLACE_EXEMPT_MAPS = [
  "Chernarus", "Sakhal", "Livonia", "chernarusplus", "sakhal", "enoch",
];

const STRUCTURE_TERRAIN = [
  // structures
  "barn", "barns", "shed", "sheds", "church", "churches", "castle", "castles",
  "apartment", "apartments", "tower", "towers", "cabin", "cabins", "warehouse", "warehouses",
  "hangar", "hangars", "bunker", "bunkers", "farmhouse", "farmhouses", "shack", "shacks",
  "garage", "garages", "hospital", "hospitals", "barracks", "lighthouse", "lighthouses",
  "rooftop", "rooftops", "stairwell", "stairwells", "attic", "attics", "basement", "basements",
  // terrain
  "coast", "coasts", "coastline", "shore", "shoreline", "beach", "beaches",
  "forest", "forests", "woods", "woodland", "treeline", "tree line",
  "hill", "hills", "hilltop", "ridge", "ridges", "ridgeline", "valley", "valleys",
  "mountain", "mountains", "peak", "peaks", "cliff", "cliffs",
  "field", "fields", "meadow", "meadows", "swamp", "swamps", "marsh", "marshes",
  "river", "rivers", "lake", "lakes", "pond", "ponds", "island", "islands", "peninsula",
  "road", "roads", "highway", "highways", "crossroads", "railway", "railroad", "tracks",
  "airfield", "airstrip", "runway", "harbor", "harbour", "docks", "port", "ports",
  "town", "towns", "village", "villages", "city", "cities", "outskirts", "district",
  // directions-as-places
  "north", "south", "east", "west", "northern", "southern", "eastern", "western",
  "northeast", "northwest", "southeast", "southwest", "inland",
];

// Community shorthand for a real place, not present as its own entry in the vendored list
// (DayZ players routinely truncate a long town name — "Elektro" for Elektrozavodsk). Curated,
// not derived by prefix-matching every place name, because guessing at abbreviations
// programmatically risks flagging ordinary words that happen to prefix a town's full name.
const COMMON_SHORTHAND = ["elektro"];

const exemptSet = new Set(PLACE_EXEMPT_MAPS.map((m) => m.toLowerCase()));

const PLACE_NAMES: string[] = [
  ...new Set(
    Object.values(places as Record<string, { name: string }[]>)
      .flat()
      .map((p) => p.name.toLowerCase())
      .filter((n) => n.length >= 3 && !exemptSet.has(n)),
  ),
];

const BANNED: string[] = [...new Set([...PLACE_NAMES, ...STRUCTURE_TERRAIN, ...COMMON_SHORTHAND])];

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** All prose the model wrote — never the deterministic fields. */
function proseOf(o: Obituary): string {
  return [o.headline, o.lede, o.body, o.pullQuote?.text ?? "", o.pullQuote?.attribution ?? "", ...o.tags].join("\n");
}

/** Distinct lower-cased banned terms found in the draft's prose; [] when clean. */
export function findPlaceViolations(obituary: Obituary, opts: { exempt: string[] }): string[] {
  let text = proseOf(obituary).toLowerCase();
  // Blank out exempt substrings (gamertags, and the map names are never in BANNED anyway) so a
  // banned word INSIDE an exempt callsign cannot trip; a free-standing use still does.
  for (const e of opts.exempt) {
    if (!e) continue;
    text = text.replaceAll(e.toLowerCase(), " ");
  }
  const hits: string[] = [];
  for (const term of BANNED) {
    const re = new RegExp(`(?<![a-z0-9])${escapeRe(term)}(?![a-z0-9])`, "i");
    if (re.test(text)) hits.push(term);
  }
  // Collapse plural/singular duplicates of the same stem for a readable feedback list.
  return [...new Set(hits)];
}
