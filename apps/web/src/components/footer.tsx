import Link from "next/link";

/** About lives here because the mobile TabBar carries the other four nav items and About is the
 *  one section a player visits once. Below `md` the footer is its only reachable route.
 *  Obituaries is in both — the tab bar as "Obits", here in full — because the short form is a
 *  compromise for a 320px column, not the surface's name.
 *  Terms and Privacy are footer-only by design: nobody navigates to them, they are reached from
 *  here and from the sign-in consent line. */
const LINKS = [
  { href: "/about", label: "About" },
  { href: "/obituaries", label: "Obituaries" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
];

const linkClass = "underline decoration-dark-line underline-offset-4 hover:text-red";

export function Footer() {
  return (
    // ⚠️ The bottom gutter for the fixed TabBar lives HERE, not on the layout's content column.
    // The footer is a sibling AFTER that column, so it is the last in-flow element in the
    // document — padding the column leaves the footer itself under the bar. Verified in a
    // browser: with the gutter on the column, scrolling to the bottom of /survivors put the bar
    // directly over this About link, and `elementFromPoint` returned the bar. About is the
    // footer's only route below `md`, so that made it unreachable on a phone.
    <footer className="bg-dark px-10 pt-[18px] pb-[calc(18px+4rem+env(safe-area-inset-bottom))] text-center font-mono text-xs uppercase tracking-[.08em] text-paper md:pb-[18px]">
      {/* ⚠️ flex-wrap, not a single line: four links overflow a 320px column. The separators are
          aria-hidden so a screen reader hears four links, not "About middot Obituaries". */}
      <nav aria-label="Site information" className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        {LINKS.map((l, i) => (
          <span key={l.href} className="flex items-center gap-x-2">
            {i > 0 && <span aria-hidden>·</span>}
            <Link href={l.href} className={linkClass}>
              {l.label}
            </Link>
          </span>
        ))}
      </nav>
      <p className="mt-2">One Life — hardcore · 1PP · US servers</p>
    </footer>
  );
}
