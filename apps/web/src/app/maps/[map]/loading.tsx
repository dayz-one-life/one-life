export default function Loading() {
  return (
    <div aria-busy="true" className="flex h-full flex-col">
      <div aria-hidden className="h-12 shrink-0 border-b border-dark-edge bg-dark" />
      <div aria-hidden className="min-h-0 flex-1 motion-safe:animate-pulse bg-dark-well" />
    </div>
  );
}
