import Link from "next/link";

export function Masthead() {
  return (
    <header className="flex items-center gap-6 border-b border-line bg-panel-2 px-6 py-3">
      <Link href="/" aria-label="One Life — home">
        <img src="/one-life-horizontal.png" alt="One Life" className="h-9 w-auto" />
      </Link>
      <Link href="/account" className="ml-auto font-mono text-[10px] uppercase tracking-widest text-muted hover:text-bone">Account</Link>
    </header>
  );
}
