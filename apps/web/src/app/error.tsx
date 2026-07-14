"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-2xl p-8 text-center">
      <h1 className="mb-2 text-2xl font-bold">Something went wrong</h1>
      <p className="mb-6 text-muted">
        We couldn&rsquo;t load this page. The server may be temporarily unavailable.
      </p>
      <button
        onClick={reset}
        className="rounded-md bg-amber px-4 py-2 text-sm font-medium text-black hover:opacity-90"
      >
        Try again
      </button>
    </main>
  );
}
