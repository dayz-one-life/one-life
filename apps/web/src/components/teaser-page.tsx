import Link from "next/link";
import { Kicker } from "@/components/tabloid/kicker";

export function TeaserPage({
  kicker, kickerColor = "red", title, line,
}: {
  kicker: string; kickerColor?: "red" | "blue"; title: string; line: string;
}) {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-16 md:px-10 md:py-24">
      <Kicker color={kickerColor}>{kicker}</Kicker>
      <h1 className="mt-3 font-display text-5xl font-bold uppercase leading-[.95] md:text-6xl">{title}</h1>
      <p className="mt-6 max-w-2xl font-mono text-sm uppercase leading-relaxed tracking-[.05em] text-ink-muted">{line}</p>
      <Link
        href="/survivors"
        className="mt-10 inline-block border-b-2 border-red font-display text-sm font-semibold uppercase tracking-[.06em] text-ink hover:text-red"
      >
        Meanwhile, the living are ranked →
      </Link>
    </main>
  );
}
