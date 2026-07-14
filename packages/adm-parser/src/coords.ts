const POSITION_RE = /pos=<\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)\s*>/u;
const MAP_MIN = -1000.0;
const MAP_MAX = 16360.0;

export function inMapBounds(x: number, y: number): boolean {
  return x >= MAP_MIN && x <= MAP_MAX && y >= MAP_MIN && y <= MAP_MAX;
}

export function parsePos(raw: string): { x: number; y: number } | null {
  if (/pos=<\s*-?\d*\.?\d+e/iu.test(raw)) return null; // off-map sentinel uses eNN notation
  const c = POSITION_RE.exec(raw);
  if (!c) return null;
  const x = parseFloat(c[1]!);
  const y = parseFloat(c[2]!);
  if (!inMapBounds(x, y)) return null;
  return { x, y };
}
