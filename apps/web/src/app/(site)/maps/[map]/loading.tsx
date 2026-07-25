/** Mirrors MapPage's own layout — a compact heading row, then the map filling the rest — so the
 *  page does not jump when the real thing arrives. */
export default function Loading() {
  return (
    <div aria-busy="true" className="flex min-h-[420px] flex-1 flex-col">
      <div className="px-4 py-3 md:px-6">
        <div aria-hidden className="h-8 w-48 bg-bone motion-safe:animate-pulse" />
      </div>
      <div aria-hidden className="min-h-0 w-auto flex-1 border-y border-ink motion-safe:animate-pulse bg-dark-well xl:-mx-10" />
    </div>
  );
}
