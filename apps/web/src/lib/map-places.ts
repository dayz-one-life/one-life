import data from "./map-places.json";

export interface MapPlace {
  /** DZMap's category: capital | city | village | local | camp | hill | ruin | marine. */
  kind: string;
  /** ALREADY a Leaflet CRS.Simple latLng on the zoom-6 tile pyramid — never re-project it. */
  lat: number;
  lng: number;
  name: string;
}

const PLACES = data as Record<string, MapPlace[]>;

/**
 * The zoom at which each category starts being labelled.
 *
 * Chernarus alone has 201 places; drawn all at once they bury the very dots the map exists
 * to show. Tiering by category is what makes this read like a map rather than a word cloud:
 * the two capitals and sixteen cities orient you when zoomed out, villages appear once a
 * region fills the screen, and the long tail of hills/camps/ruins/local landmarks only once
 * you are reading a single valley.
 *
 * An unknown category (a DayZ update adding one) falls back to the most restrictive tier —
 * a new category may not silently flood the zoomed-out view.
 */
const MIN_ZOOM: Record<string, number> = {
  capital: 0,
  city: 0,
  village: 2,
};
export const PLACE_FALLBACK_MIN_ZOOM = 4;

export function placeMinZoom(kind: string): number {
  return MIN_ZOOM[kind] ?? PLACE_FALLBACK_MIN_ZOOM;
}

/** Every place to label on this map at this zoom. Unknown map codename ⇒ none, never a throw. */
export function placesFor(mapCodename: string, zoom: number): MapPlace[] {
  const all = PLACES[mapCodename];
  if (!all) return [];
  return all.filter((p) => zoom >= placeMinZoom(p.kind));
}

/** Type class for the label's visual weight — settlements read louder than terrain features. */
export function placeWeight(kind: string): "major" | "minor" | "faint" {
  if (kind === "capital" || kind === "city") return "major";
  if (kind === "village") return "minor";
  return "faint";
}

const WEIGHT_ORDER: Record<string, number> = { major: 0, minor: 1, faint: 2 };

/**
 * Name search across EVERY place on a map, regardless of the zoom tier that would draw it —
 * a landmark you cannot see yet is exactly the thing you search for by name. Flying to a
 * result zooms in far enough to render its tier.
 *
 * Ranking: bigger places first (major → minor → faint), then within each tier prefix matches
 * before interior matches, then alphabetically. Purely local over the vendored data — there is
 * no search endpoint.
 */
export function searchPlaces(mapCodename: string, query: string, limit = 8): MapPlace[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  const all = PLACES[mapCodename];
  if (!all) return [];

  return all
    .filter((p) => p.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const aw = WEIGHT_ORDER[placeWeight(a.kind)]!;
      const bw = WEIGHT_ORDER[placeWeight(b.kind)]!;
      if (aw !== bw) return aw - bw;
      const aPrefix = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bPrefix = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      if (aPrefix !== bPrefix) return aPrefix - bPrefix;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}
