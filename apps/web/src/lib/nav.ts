export const NAV_ITEMS = [
  { key: "home", href: "/", label: "Home" },
  // `/maps` is a redirect that resolves where "here" is — see lib/map-resolution.ts.
  // The item is deliberately a plain static href. NAV_ITEMS is a plain module-level constant,
  // and its hrefs are section ROOTS that `activeNavKey` below pairs with by prefix — a href
  // resolved per viewer would be a concrete map URL, breaking that pairing and making the list
  // depend on session state it has no access to. The redirect does the resolving, on the server,
  // once. (Today `shell/nav-menu.tsx` is the only renderer; that is why this reasoning is about
  // the list itself and not about keeping two call sites in step.)
  { key: "maps", href: "/maps", label: "Maps" },
  // "Survivors" everywhere the surface is named: it matches the URL, the board H1, the SEO
  // titles, the dossier back-link and the About copy. (The key stays `leaderboard` — it is
  // internal, and renaming it would churn every activeNavKey consumer for no user-visible gain.)
  { key: "leaderboard", href: "/survivors", label: "Survivors" },
  { key: "obituaries", href: "/obituaries", label: "Obituaries" },
  { key: "about", href: "/about", label: "About" },
] as const;

export type NavKey = (typeof NAV_ITEMS)[number]["key"];

const inSection = (pathname: string, base: string) => pathname === base || pathname.startsWith(base + "/");

/**
 * Which nav item a pathname lights up. Player pages belong to the Survivors section — they are
 * reached from the board.
 *
 * ⚠️ Home is an EXACT match, never `inSection`. Every path in the app starts with "/", so a prefix
 * rule here would light Home up on every page in the site.
 */
export function activeNavKey(pathname: string): NavKey | null {
  if (pathname === "/") return "home";
  if (inSection(pathname, "/maps")) return "maps";
  if (inSection(pathname, "/survivors") || inSection(pathname, "/players")) return "leaderboard";
  if (inSection(pathname, "/obituaries")) return "obituaries";
  if (inSection(pathname, "/about")) return "about";
  return null;
}
