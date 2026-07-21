export default function Loading() {
  return (
    <main aria-busy="true" className="mx-auto w-full max-w-2xl px-6 py-10 md:px-10">
      <div className="border-b-[3px] border-ink pb-4">
        <div aria-hidden className="h-10 w-52 motion-safe:animate-pulse bg-bone" />
        <div aria-hidden className="mt-3 h-3 w-72 motion-safe:animate-pulse bg-bone" />
      </div>
      <div className="mt-5 flex flex-col gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} aria-hidden className="h-16 motion-safe:animate-pulse bg-bone" />
        ))}
      </div>
    </main>
  );
}
