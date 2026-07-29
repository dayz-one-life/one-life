/**
 * The pending home's opening lead (pending-verification spec §2): the page has no hero for
 * pending, so this is its h1 — a compact tabloid kicker + headline above the ladder. Rendered
 * ONLY by AccountPanels' pending branch; unlinked keeps the pitch hero's h1 instead.
 */
export function PendingLead() {
  return (
    <header className="pt-2">
      <p className="font-mono text-[11px] uppercase tracking-[.16em] text-red-deep">One step left</p>
      <h1 className="mt-1.5 font-display text-4xl font-bold uppercase leading-none text-ink md:text-5xl">
        Prove it&rsquo;s you in game
      </h1>
    </header>
  );
}
