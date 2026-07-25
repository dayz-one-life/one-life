import type { ReactNode } from "react";

/**
 * The count is the ONLY live part of any page header, and it is exactly where "loading rendered as
 * an authoritative zero" keeps recurring in this codebase. It is therefore a discriminated union
 * rather than a number, so the honest-rendering matrix is solved once here instead of separately
 * at every call site (live-data honesty §5).
 */
export type HeaderCount =
  | { kind: "loading" }
  | { kind: "ready"; value: number; noun: string }
  | { kind: "failed" };

function Count({ count }: { count: HeaderCount }) {
  if (count.kind === "loading") {
    return (
      <span aria-busy="true" aria-hidden className="inline-block h-3 w-16 bg-bone align-middle motion-safe:animate-pulse" />
    );
  }
  if (count.kind === "failed") {
    // Explicit, never silent: "we don't know" and "there are none" are different claims, and a
    // blank space reads as the second one.
    return <span role="status">Couldn&apos;t load the count</span>;
  }
  return (
    <span>
      {count.value} {count.noun}
    </span>
  );
}

/**
 * Shared page header: title · count · control.
 *
 * ⚠️ Ordinary flow content — NO z-index and NO sticky. The app has exactly three z-altitudes
 * (LAYER LEGEND in components/header.tsx) and a header that layered itself would become a fourth.
 */
export function PageHeader({
  title,
  count,
  control,
}: {
  title: string;
  count?: HeaderCount;
  control?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b-[3px] border-ink pb-2.5">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h1 className="font-display text-3xl font-bold uppercase tracking-[.02em] text-ink">{title}</h1>
        {count && (
          <p className="font-mono text-[11.5px] uppercase tracking-[.05em] text-ink-muted">
            <Count count={count} />
          </p>
        )}
      </div>
      {control}
    </div>
  );
}
