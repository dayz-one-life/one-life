export const NAV_ITEMS = [
  { key: "news", href: "/news", label: "News" },
  { key: "obituaries", href: "/obituaries", label: "Obituaries" },
  { key: "fresh-spawns", href: "/fresh-spawns", label: "Fresh Spawns" },
  { key: "survivors", href: "/survivors", label: "Survivors" },
  { key: "about", href: "/about", label: "About" },
] as const;

export type NavKey = (typeof NAV_ITEMS)[number]["key"];

const inSection = (pathname: string, base: string) => pathname === base || pathname.startsWith(base + "/");

/** Which nav item a pathname lights up. Player pages belong to the Survivors section. */
export function activeNavKey(pathname: string): NavKey | null {
  if (inSection(pathname, "/news")) return "news";
  if (inSection(pathname, "/obituaries")) return "obituaries";
  if (inSection(pathname, "/fresh-spawns")) return "fresh-spawns";
  if (inSection(pathname, "/survivors") || inSection(pathname, "/players")) return "survivors";
  if (inSection(pathname, "/about")) return "about";
  return null;
}
