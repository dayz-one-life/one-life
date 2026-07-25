/**
 * Home's two-line tokens readout: the balance, and what it is for.
 *
 * ⚠️ This is a SUMMARY, not the tokens panel. Sending and the referrer field stay on `/you` — a
 * control panel should show state and afford the one action that state needs, and spending is
 * afforded on the ban row itself (which already knows WHICH ban to lift), never here.
 *
 * ⚠️ `Earn / buy →` is deliberately absent: `/tokens` does not exist until sub-project F. A link
 * to a 404 is worse than no link.
 */
export function TokensSummary({
  balance,
  loading,
}: {
  balance: number | null;
  /** True while the balance is unresolved (loading or errored). A `?? 0` here would assert a
   *  fabricated "0 tokens" — and, transitively, "you cannot buy your way out" — from an unknown
   *  state (live-data honesty §5). */
  loading: boolean;
}) {
  return (
    <section aria-label="Unban tokens" className="flex items-center justify-between gap-4 border border-hairline bg-white px-4 py-3.5">
      <div className="min-w-0">
        <h3 className="font-display text-[13px] font-bold uppercase tracking-[.1em] text-ink">
          Unban tokens
        </h3>
        <p className="mt-1 font-mono text-[10.5px] uppercase tracking-[.04em] text-ink-muted">
          Spend one to lift a ban · +1 every 1st
        </p>
      </div>
      {loading || balance === null ? (
        <span aria-busy="true" className="inline-block h-[26px] w-9 flex-none bg-bone motion-safe:animate-pulse">
          <span className="sr-only">Checking your balance…</span>
        </span>
      ) : (
        <span className="flex-none font-display text-[26px] font-bold leading-none text-ink">
          {balance}
        </span>
      )}
    </section>
  );
}
