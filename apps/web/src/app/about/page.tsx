import type { Metadata } from "next";
import Link from "next/link";
import { getServers } from "@/lib/api";
import type { Server } from "@/lib/types";
import { mapLabel } from "@/components/player/format";
import { serverTagline, formatOrList, countWord } from "@/lib/server-blurbs";
import { Kicker } from "@/components/tabloid/kicker";
import { SignInCta } from "@/components/front-page/signin-cta";

export const metadata: Metadata = {
  title: "About",
  description:
    "How One Life works — one life per server, a 24-hour ban when it ends, and an obituary that stands forever.",
};

const STEPS = (maps: string) => [
  {
    n: "1",
    title: "You live",
    body: (
      <>
        Wash ashore on {maps}. Survive the five-minute grace period and your life is{" "}
        <em className="not-italic font-semibold">qualified</em> — a birth announcement runs, and every
        hour after is tracked and ranked on <Link href="/survivors" className="underline decoration-red decoration-2 underline-offset-2">Survivors</Link>.
      </>
    ),
  },
  {
    n: "2",
    title: "You die",
    body: (
      <>
        A qualified death bans you from that server for{" "}
        <em className="not-italic font-semibold">24 hours</em> and the Morgue Desk publishes the
        obituary — cause, weapon, distance, the lot. The other servers don't care. The obituary is
        permanent.
      </>
    ),
  },
  {
    n: "3",
    title: "You wait — or you pay",
    body: (
      <>
        Sit out the 24 hours, or spend one <em className="not-italic font-semibold">unban token</em>{" "}
        to walk back in immediately. Tokens are earned, sent between players, and hoarded for the day
        it's you in the dirt. The obituary still stands.
      </>
    ),
  },
];

const RULES = [
  {
    term: "Hardcore, by default",
    def: "First-person only. No crosshair. Loot cut fifty percent across the board, zombie counts nudged up two. The world is meaner than the one you know, on purpose.",
  },
  {
    term: "The five-minute grace",
    def: "Every life opens with five minutes of grace. Hate your spawn? Reset it, free — die and try again as often as you like. But throw a punch or take a shot at another survivor and the life qualifies early. Five minutes of play, or one act of violence, whichever comes first. After that, death is real.",
  },
  {
    term: "One gamertag, proven",
    def: "Sign in, then name the Xbox gamertag you already play under — we suggest tags we've seen but haven't verified. To prove it's yours, the site shows three random emotes; perform them in-game in that order (other emotes in between are fine). Anyone can attempt a tag, but only the person holding the controller finishes the sequence. Unfinished attempts expire in 24 hours. One tag per account, forever.",
  },
  {
    term: "The token economy",
    def: "Verifying earns you two tokens on the spot — one to keep, one for the current month. Another lands on the first of every month. Spend them to lift a ban, send them to any verified survivor, stockpile them, or trade them for whatever someone's willing to part with. Transfers are final.",
  },
];

export default async function AboutPage() {
  const servers = (await getServers().catch(() => [] as Server[])).filter((s) => s.active && s.slug);
  const maps = formatOrList(servers.map((s) => mapLabel(s.map)));

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10 md:px-10 md:py-14">
      {/* Manifesto header */}
      <header className="border-b-[3px] border-ink pb-8">
        <Kicker>About the paper</Kicker>
        <h1 className="mt-3 font-display text-5xl font-bold uppercase leading-[.9] md:text-7xl">
          Everyone here dies. We write it down.
        </h1>
        <p className="mt-5 max-w-3xl font-sans text-lg leading-relaxed text-ink-soft">
          One Life is a set of hardcore DayZ servers with a newsroom bolted on. You get one life per
          server. When a qualified life ends — and it will — you're banned for 24 hours and the
          obituary writes itself. The living are ranked. The dead are remembered, unkindly.
        </p>
      </header>

      {/* 1/2/3 strip */}
      <section aria-label="How it works" className="grid gap-8 py-10 md:grid-cols-3 md:gap-0 md:divide-x md:divide-hairline">
        {STEPS(maps || "the coast").map((s) => (
          <div key={s.n} className="md:px-7 md:first:pl-0 md:last:pr-0">
            <div aria-hidden className="font-display text-6xl font-bold leading-none text-red">{s.n}</div>
            <h2 className="mt-3 font-display text-2xl font-bold uppercase">{s.title}</h2>
            <p className="mt-2 font-sans text-base leading-relaxed text-ink-soft">{s.body}</p>
          </div>
        ))}
      </section>

      {/* Rules of record */}
      <section aria-labelledby="rules-heading">
        <h2 id="rules-heading" className="border-b-[3px] border-ink pb-2 font-display text-2xl font-bold uppercase">
          The rules of record
        </h2>
        <dl>
          {RULES.map((r) => (
            <div key={r.term} className="grid gap-2 border-b border-hairline py-4 md:grid-cols-[190px_1fr] md:gap-6">
              <dt className="font-mono text-xs font-bold uppercase tracking-[.06em] text-red-deep">{r.term}</dt>
              <dd className="m-0 font-sans text-base leading-relaxed text-ink-soft">{r.def}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Servers */}
      {servers.length > 0 && (
        <section aria-labelledby="servers-heading" className="mt-10">
          <h2 id="servers-heading" className="border-b-[3px] border-ink pb-2 font-display text-2xl font-bold uppercase">
            {countWord(servers.length)} server{servers.length === 1 ? "" : "s"}
          </h2>
          <div className="grid gap-4 py-5 md:grid-cols-3">
            {servers.map((s) => (
              <div key={s.id} className="border border-hairline bg-paper p-5">
                <h3 className="font-display text-[22px] font-bold uppercase">{mapLabel(s.map)}</h3>
                <p className="mt-2 font-mono text-[11px] uppercase leading-relaxed tracking-[.05em] text-ink-muted">
                  {serverTagline(s.slug!)}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      <SignInCta />
    </main>
  );
}
