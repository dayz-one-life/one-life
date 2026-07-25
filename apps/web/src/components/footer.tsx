import Link from "next/link";

/** About lives here because the mobile TabBar carries the other three nav items and About is the
 *  one section a player visits once. Below `md` the footer is its only reachable route. */
export function Footer() {
  return (
    <footer className="bg-dark px-10 py-[18px] text-center font-mono text-xs uppercase tracking-[.08em] text-paper">
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
