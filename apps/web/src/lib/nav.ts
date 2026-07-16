export const NAV_ITEMS = [
  { key: "news", href: "/news", label: "News" },
  { key: "obituaries", href: "/obituaries", label: "Obituaries" },
  { key: "fresh-spawns", href: "/fresh-spawns", label: "Fresh Spawns" },
  { key: "survivors", href: "/survivors", label: "Survivors" },
  { key: "about", href: "/about", label: "About" },
] as const;

export type NavKey = (typeof NAV_ITEMS)[number]["key"];

/** Which nav item a pathname lights up. Player pages belong to the Survivors section. */
export function activeNavKey(pathname: string): NavKey | null {
  if (pathname.startsWith("/news")) return "news";
  if (pathname.startsWith("/obituaries")) return "obituaries";
  if (pathname.startsWith("/fresh-spawns")) return "fresh-spawns";
  if (pathname.startsWith("/survivors") || pathname.startsWith("/players")) return "survivors";
  if (pathname.startsWith("/about")) return "about";
  return null;
}
