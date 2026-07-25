import Link from "next/link";

/** About lives here because the mobile TabBar carries the other three nav items and About is the
 *  one section a player visits once. Below `md` the footer is its only reachable route. */
export function Footer() {
  return (
    // ⚠️ The bottom gutter for the fixed TabBar lives HERE, not on the layout's content column.
    // The footer is a sibling AFTER that column, so it is the last in-flow element in the
    // document — padding the column leaves the footer itself under the bar. Verified in a
    // browser: with the gutter on the column, scrolling to the bottom of /survivors put the bar
    // directly over this About link, and `elementFromPoint` returned the bar. About is the
    // footer's only route below `md`, so that made it unreachable on a phone.
    <footer className="bg-dark px-10 pt-[18px] pb-[calc(18px+4rem+env(safe-area-inset-bottom))] text-center font-mono text-xs uppercase tracking-[.08em] text-paper md:pb-[18px]">
      <Link href="/about" className="underline decoration-dark-line underline-offset-4 hover:text-red">
        About
      </Link>
      <span aria-hidden className="px-2">
        ·
      </span>
      One Life — hardcore · 1PP · US servers
    </footer>
  );
}
