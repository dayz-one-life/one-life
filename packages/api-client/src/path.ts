/**
 * Backend mounts Better Auth under /api/auth but read/me/gamertag routes at root.
 * The client goes through the Next rewrite (which does this mapping itself), so
 * this is only used to build the absolute server-side URL.
 */
export function toBackendPath(p: string): string {
  if (p === "/api/auth" || p.startsWith("/api/auth/")) return p;
  if (p.startsWith("/api/")) return p.slice(4); // "/api/servers" -> "/servers"
  return p;
}
