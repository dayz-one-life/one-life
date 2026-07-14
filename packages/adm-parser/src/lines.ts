const CONNECTING_RE = /Player "([^"]+)"\s*\(id=([^\s)]+)[^)]*\) is connecting/u;
const CONNECTED_RE = /Player "([^"]+)"\s*\(id=([^\s)]+)[^)]*\) is connected/u;
const DISCONNECT_RE = /Player "([^"]+)"\s*\(id=([^\s)]+)[^)]*\) has been disconnected/u;
const HEADER_RE = /AdminLog started on (\d{4})-(\d{2})-(\d{2}) at (\d{2}):(\d{2}):(\d{2})/;
const ROSTER_RE = /#####\s*PlayerList log:\s*(\d+)\s*players/u;

export function parseConnecting(raw: string): { gamertag: string; dayzId: string } | null {
  const m = CONNECTING_RE.exec(raw);
  return m ? { gamertag: m[1]!, dayzId: m[2]! } : null;
}
export function parseConnected(raw: string): { gamertag: string; dayzId: string } | null {
  if (/ is connecting/.test(raw)) return null;
  const m = CONNECTED_RE.exec(raw);
  return m ? { gamertag: m[1]!, dayzId: m[2]! } : null;
}
export function parseDisconnected(raw: string): { gamertag: string; dayzId: string } | null {
  const m = DISCONNECT_RE.exec(raw);
  return m ? { gamertag: m[1]!, dayzId: m[2]! } : null;
}
export function parseBoot(raw: string): string | null {
  const m = HEADER_RE.exec(raw);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}` : null;
}
export function parseRoster(raw: string): { count: number } | null {
  const m = ROSTER_RE.exec(raw);
  return m ? { count: +m[1]! } : null;
}
