import Link from "next/link";
import { Kicker } from "@/components/tabloid/kicker";

export function Hero() {
  return (
    <section className="border-b-[3px] border-ink px-6 py-10 md:px-10 md:py-14">
      <Kicker>The paper of record</Kicker>
      <h1 className="mt-3 font-display text-5xl font-bold uppercase leading-[.95] md:text-7xl">
        One life. Then the obituary.
      </h1>
      <p className="mt-5 max-w-3xl font-sans text-lg leading-relaxed text-ink-soft">
        Hardcore permadeath DayZ, covered like celebrity scandal. One life per server; when it
        ends, the ban is real and the write-up is forever. The living are ranked below. The
        presses are warming up.
      </p>
      <Link
        href="/about"
        className="mt-6 inline-block border-b-2 border-red font-display text-sm font-semibold uppercase tracking-[.06em] text-ink hover:text-red"
      >
        How it works →
      </Link>
    </section>
  );
}
