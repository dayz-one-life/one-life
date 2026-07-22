export default function Loading() {
  return (
    <div aria-busy="true" className="mx-auto max-w-[68ch] px-4 py-8">
      <div aria-hidden className="h-9 w-32 motion-safe:animate-pulse bg-bone" />
      <div aria-hidden className="mt-6 h-[420px] motion-safe:animate-pulse bg-bone" />
    </div>
  );
}
