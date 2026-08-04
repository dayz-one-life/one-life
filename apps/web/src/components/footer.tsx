import Link from "next/link";
import { SocialLinks } from "./social-links";

/** About, Obituaries, Terms and Privacy. About and Obituaries are also in the nav menu; these
 *  are the reading routes at the bottom of a page. Terms and Privacy are footer-only by design:
 *  nobody navigates to them, they are reached from here and from the sign-in consent line. */
const LINKS = [
  { href: "/about", label: "About" },
  { href: "/obituaries", label: "Obituaries" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
];

const linkClass = "underline decoration-dark-line underline-offset-4 hover:text-red";

export function Footer() {
  return (
    // ⚠️ The bottom safe-area inset lives HERE, not on the layout's content column. The footer
    // is a sibling AFTER that column, so it is the last in-flow element in the document —
    // padding the column leaves the footer under the phone's home indicator. It used to reserve
    // the fixed TabBar's 4rem too (verified in a browser: with the gutter on the column the bar
    // sat directly over this About link); the bar is deleted, the reasoning is not.
    <footer className="bg-dark px-10 pt-[18px] pb-[calc(18px+env(safe-area-inset-bottom))] text-center font-mono text-xs uppercase tracking-[.08em] text-paper">
      {/* Above the text row, and never below it: the bottom safe-area inset above belongs to the
          LAST in-flow element, so anything appended after the colophon would sit under the home
          indicator. */}
      <SocialLinks />
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
