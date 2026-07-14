/** Human "expires in Xh"/"Ym" string for a challenge deadline; "expired" at/after it. */
export function formatExpiry(expiresAt: string, now: number): string {
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return "expired";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `expires in ${mins}m`;
  return `expires in ${Math.floor(mins / 60)}h`;
}
