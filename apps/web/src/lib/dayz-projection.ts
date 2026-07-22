/** DayZ world extents in metres, keyed by `servers.map` (the mission codename).
 *  `enoch` is Livonia. A codename absent here yields null — we never guess a size,
 *  because a wrong size silently misplaces every point on the map. */
export const MAP_WORLD_SIZE: Record<string, number> = {
  chernarusplus: 15360,
  sakhal: 15360,
  enoch: 12800,
};

export function worldSize(mapCodename: string): number | null {
  return MAP_WORLD_SIZE[mapCodename] ?? null;
}

/**
 * World metres → tile-pyramid pixels at max zoom.
 *
 * DayZ's origin is bottom-left with y as northing; Leaflet's pixel origin is top-left
 * with y growing downward, so y is flipped. `canvasPx` is the pixel extent of the tile
 * pyramid at max zoom and is passed in rather than derived — see the comment in
 * track-map.tsx for how it is established against the real tiles.
 */
export function worldToPixel(
  x: number, y: number, size: number, canvasPx: number,
): [number, number] {
  const k = canvasPx / size;
  return [x * k, (size - y) * k];
}

/**
 * Tile-pyramid pixels at max zoom → world metres. The exact inverse of `worldToPixel`,
 * including the northing flip (DayZ's origin is bottom-left; Leaflet's is top-left).
 *
 * Used by the map's coordinate readout. Keep it here, beside its inverse, so the projection
 * rules live in one module and `canvasPx` stays a single parameter.
 */
export function pixelToWorld(
  px: number, py: number, size: number, canvasPx: number,
): [number, number] {
  const k = canvasPx / size;
  return [px / k, size - py / k];
}

/**
 * World metres → the Leaflet `CRS.Simple` latLng that `MapCanvas` draws in.
 *
 * For consumers that need to NAME a point ("fly to my dot") without holding a map instance —
 * the Leaflet lifecycle stays sealed in map-canvas.tsx. CRS.Simple divides the pixel plane by
 * 2**zoom and flips y, which is why this is not just `worldToPixel`.
 */
export function worldToLatLng(
  x: number, y: number, size: number, canvasPx: number, maxZoom: number,
): { lat: number; lng: number } {
  const [px, py] = worldToPixel(x, y, size, canvasPx);
  const scale = 2 ** maxZoom;
  return { lat: -py / scale, lng: px / scale };
}
