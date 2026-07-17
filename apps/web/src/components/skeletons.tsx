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
      {Array.from({ length: 9 }, (_, i) => (
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
      <div className="mt-7 grid gap-5 md:grid-cols-2">
        <Bar className="h-48" />
        <Bar className="h-48" />
        <Bar className="h-36" />
        <Bar className="h-36" />
      </div>
    </main>
  );
}
