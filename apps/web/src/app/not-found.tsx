import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl p-8 text-center">
      <h1 className="mb-2 text-2xl font-bold">Not found</h1>
      <p className="mb-6 text-muted">That page doesn&rsquo;t exist.</p>
      <Link href="/" className="rounded-md bg-amber px-4 py-2 text-sm font-medium text-black hover:opacity-90">
        Go home
      </Link>
    </main>
  );
}
