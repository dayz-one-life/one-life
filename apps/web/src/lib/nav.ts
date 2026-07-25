export const NAV_ITEMS = [
  { key: "home", href: "/", label: "Home" },
  // `/maps` is a redirect that resolves the viewer's last-opened map — see lib/last-map.ts.
  // The item is deliberately a plain static href: the nav renders in two places (the desktop
  // row and the mobile menu) and a stateful item would have to be threaded through both.
  { key: "maps", href: "/maps", label: "Maps" },
  // Label-only rename of Survivors. The ROUTE stays `/survivors` — sub-project D owns the move to
  // a per-map leaderboard, and repointing this href would break every board link today.
  { key: "leaderboard", href: "/survivors", label: "Leaderboard" },
  { key: "about", href: "/about", label: "About" },
] as const;

export type NavKey = (typeof NAV_ITEMS)[number]["key"];

const inSection = (pathname: string, base: string) => pathname === base || pathname.startsWith(base + "/");

/**
 * Which nav item a pathname lights up. Player pages belong to the Leaderboard section — they are
 * reached from the board.
 *
 * ⚠️ Home is an EXACT match, never `inSection`. Every path in the app starts with "/", so a prefix
 * rule here would light Home up on every page in the site.
 */
export function activeNavKey(pathname: string): NavKey | null {
  if (pathname === "/") return "home";
  if (inSection(pathname, "/maps")) return "maps";
  if (inSection(pathname, "/survivors") || inSection(pathname, "/players")) return "leaderboard";
  if (inSection(pathname, "/about")) return "about";
  return null;
}
