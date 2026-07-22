export default function Loading() {
  return (
    <div aria-busy="true" className="flex h-[calc(100dvh-7rem)] min-h-[520px] flex-col px-4 py-6">
      <div aria-hidden className="h-9 w-32 motion-safe:animate-pulse bg-bone" />
      <div aria-hidden className="mt-4 min-h-0 flex-1 motion-safe:animate-pulse bg-bone" />
    </div>
  );
}
