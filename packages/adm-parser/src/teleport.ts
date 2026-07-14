const TELEPORT_RE = /Player "([^"]+)"[^)]*\) was teleported from: <([^>]+)> to: <([^>]+)>\. Reason: (.+?)\s*$/u;

function triple(s: string): [number, number, number] {
  const parts = s.split(",").map((n) => parseFloat(n.trim()));
  return [parts[0]!, parts[1]!, parts[2]!];
}

export function parseTeleport(raw: string): {
  gamertag: string; from: [number, number, number]; to: [number, number, number]; reason: string;
} | null {
  const m = TELEPORT_RE.exec(raw);
  if (!m) return null;
  return { gamertag: m[1]!, from: triple(m[2]!), to: triple(m[3]!), reason: m[4]! };
}
