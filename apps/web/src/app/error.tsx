"use client";
import { SkewCta } from "@/components/tabloid/skew-cta";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-center">
      <p className="font-display text-sm font-bold uppercase tracking-[.14em] text-red">Stop the presses</p>
      <h1 className="mt-1 font-display text-4xl font-bold uppercase text-ink">Something went wrong</h1>
      <p className="mt-2 font-mono text-xs uppercase tracking-[.04em] text-ink-muted">
        We couldn&rsquo;t load this page. The server may be temporarily unavailable.
      </p>
      <div className="mt-6">
        <SkewCta onClick={reset}>Try again</SkewCta>
      </div>
    </main>
  );
}
