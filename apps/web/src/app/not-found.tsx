import { SkewCta } from "@/components/tabloid/skew-cta";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-center">
      <p className="font-display text-sm font-bold uppercase tracking-[.14em] text-red">404</p>
      <h1 className="mt-1 font-display text-4xl font-bold uppercase text-ink">Not found</h1>
      <p className="mt-2 font-mono text-xs uppercase tracking-[.04em] text-ink-muted">
        That page doesn&rsquo;t exist. The trail goes cold here.
      </p>
      <div className="mt-6">
        <SkewCta href="/">Front page →</SkewCta>
      </div>
    </main>
  );
}
