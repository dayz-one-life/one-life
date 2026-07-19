import { cn } from "@/lib/utils";

function Bar({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse bg-bone", className)} />;
}

/** Route-level loading state for the survivors board — mirrors the board's container metrics. */
export function BoardSkeleton() {
  return (
    <main aria-busy="true" className="mx-auto w-full max-w-5xl px-6 py-10 md:px-10">
      <div className="border-b-[3px] border-ink pb-4">
        <Bar className="h-10 w-64 max-w-full" />
        <Bar className="mt-3 h-3 w-96 max-w-full" />
      </div>
      <div className="mt-4 flex flex-wrap gap-2 border-b border-ink pb-3.5">
        <Bar className="h-7 w-24" />
        <Bar className="h-7 w-24" />
        <Bar className="h-7 w-24" />
      </div>
      <div className="border-b border-hairline py-4">
        <Bar className="h-[76px]" />
      </div>
      {Array.from({ length: 2 }, (_, i) => (
        <div key={`p${i}`} className="border-b border-hairline py-3.5">
          <Bar className="h-[60px]" />
        </div>
      ))}
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="border-b border-hairline-2 py-3">
          <Bar className="h-6" />
        </div>
      ))}
    </main>
  );
}

/** Route-level loading state for the player dossier. */
export function DossierSkeleton() {
  return (
    <main aria-busy="true" className="mx-auto w-full max-w-5xl px-6 py-10 md:px-10">
      <Bar className="h-3 w-24" />
      <div className="mt-3 border-b-[3px] border-ink pb-6">
        <Bar className="h-3 w-72 max-w-full" />
        <Bar className="mt-2 h-14 w-80 max-w-full" />
        <div className="mt-5 flex gap-9">
          <Bar className="h-12 w-16" />
          <Bar className="h-12 w-16" />
          <Bar className="h-12 w-16" />
          <Bar className="h-12 w-24" />
        </div>
      </div>
      <div className="mt-7">
        <Bar className="h-5 w-44" />
        <div className="mt-3 grid gap-5 md:grid-cols-2">
          <Bar className="h-40" />
          <Bar className="h-40" />
        </div>
      </div>
      <div className="mt-8">
        <Bar className="h-5 w-56" />
        <div className="mt-3 grid gap-5 md:grid-cols-2">
          <Bar className="h-32" />
          <Bar className="h-32" />
        </div>
      </div>
    </main>
  );
}

/** Route-level loading state for a single life's timeline. */
export function LifeSkeleton() {
  return (
    <main aria-busy="true" className="mx-auto w-full max-w-5xl px-6 py-10 md:px-10">
      <Bar className="h-3 w-40" />
      <div className="mt-3 flex gap-6 border-b-[3px] border-ink pb-5">
        <Bar className="h-[132px] w-[132px]" />
        <div className="flex-1 space-y-3">
          <Bar className="h-3 w-56" />
          <Bar className="h-12 w-3/4" />
          <Bar className="h-7 w-full" />
        </div>
      </div>
      <div className="mt-8 space-y-6">
        {[0, 1, 2, 3].map((i) => (
          <Bar key={i} className="h-16" />
        ))}
      </div>
    </main>
  );
}

/** Placeholder for the generated tabloid photo atop an article interior, before it (or its
 *  absence) is known — mirrors ArticleHero's 4:5 max-w-md frame. Since R5d PR-C3 the `news`
 *  kind is the only one that renders a hero image (obituaries/birth notices lost theirs in
 *  v0.21.0), so this is the news interior's placeholder: it is rendered by
 *  apps/web/src/app/news/[slug]/loading.tsx. */
export function ArticleHeroSkeleton() {
  return <Bar className="my-6 aspect-[4/5] w-full max-w-md" />;
}

/** Route-level loading state for the obituaries feed. */
export function ObituariesSkeleton() {
  return (
    <main aria-busy="true" className="mx-auto w-full max-w-5xl px-6 py-10 md:px-10">
      <div className="border-b-[3px] border-ink pb-4">
        <Bar className="h-9 w-56 max-w-full" />
        <Bar className="mt-3 h-3 w-80 max-w-full" />
      </div>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="border-b border-hairline py-6">
          <Bar className="h-3 w-40" />
          <Bar className="mt-2 h-8 w-full max-w-xl" />
          <Bar className="mt-3 h-3 w-96 max-w-full" />
        </div>
      ))}
    </main>
  );
}
