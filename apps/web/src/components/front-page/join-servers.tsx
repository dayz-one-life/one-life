import { FitLine } from "./fit-line";

/**
 * The universal connect beat (join-the-servers spec §4): a full-bleed yellow slab — the only
 * yellow section on the site — with the three moves as dashed paper tickets and a stylized
 * replica of the Xbox server-browser screen. Identical on every surface.
 *
 * ⚠️ THE REPLICA IS AN ILLUSTRATION, NOT A DATA SURFACE (spec §4.3). The player counts are
 * static example numbers, and the caption ("What you'll see on your screen") is what makes
 * that honest — this is a picture of the game's own UI, like a screenshot in a manual. Do not
 * wire it to live data, and do not cite it as precedent for fabricated counts on any surface
 * that presents OUR data. The host names (`One Life <Map> | dayzonelife.com`) are BRAND COPY,
 * verified against a real console screenshot (2026-07-29) and maintained by hand — a Nitrado
 * rename must update them here.
 */
const HOSTS = [
  // Host A–Z, the real browser's default sort. Add Badlands here when it ships.
  { map: "Chernarus", players: "14/26" },
  { map: "Livonia", players: "3/16" },
  { map: "Sakhal", players: "6/26" },
];

const STEPS = [
  { ordinal: "First", move: "Search “One Life”" },
  { ordinal: "Second", move: "Pick your map" },
  { ordinal: "Third", move: "Favorite them", star: true },
];

function BrowserReplica() {
  return (
    <div data-testid="browser-replica" className="w-full border-[3px] border-ink bg-dark">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-3 font-mono text-[12px] uppercase tracking-[.08em]">
        <span className="text-cream-muted">Favorites</span>
        <span className="text-cream-muted">Official</span>
        <span className="bg-red px-2 py-0.5 font-bold text-white">Community</span>
      </div>
      <div className="mt-3 flex items-center gap-3 bg-red px-4 py-2.5">
        <span className="font-mono text-[12px] font-bold uppercase tracking-[.1em] text-white">
          Search by name
        </span>
        <span className="flex flex-1 items-center gap-1 border-2 border-white/80 bg-dark px-3 py-1.5">
          <span className="font-mono text-base font-bold uppercase tracking-[.06em] text-paper">One Life</span>
          <span aria-hidden="true" className="inline-block h-4 w-[8px] bg-paper motion-safe:animate-pulse" />
        </span>
      </div>
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 border-b border-dark-line px-4 py-2 font-mono text-[11px] uppercase tracking-[.1em] text-cream-muted">
        <span>Host</span>
        <span>Map</span>
        <span className="text-right">Players</span>
      </div>
      {/* Explicit role: preflight's list-style-none strips implicit list semantics in Safari/VO. */}
      <ul role="list">
        {HOSTS.map((h) => (
          <li
            key={h.map}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 border-b border-dark-line px-4 py-2.5 font-mono text-[11px] md:text-[13px]"
          >
            <span className="min-w-0 truncate text-paper">
              <span aria-hidden="true" className="mr-2 text-yellow">★</span>
              One Life {h.map} | dayzonelife.com
            </span>
            <span className="text-cream-dim">{h.map}</span>
            <span className="text-right text-cream-dim">{h.players}</span>
          </li>
        ))}
      </ul>
      <div className="px-4 py-2 font-mono text-[11px] uppercase tracking-[.08em] text-cream-muted">
        Servers found: {HOSTS.length}
      </div>
    </div>
  );
}

export function JoinServers() {
  return (
    <section aria-label="Join the servers" className="border-y-4 border-ink bg-yellow px-6 py-14 text-ink md:px-10">
      <h2 className="font-display font-bold uppercase leading-none">
        <FitLine finalText="Join the servers" lineClassName="text-[clamp(2.5rem,8vw,9rem)]">
          Join the servers
        </FitLine>
      </h2>
      <ol role="list" aria-label="How to join" className="mt-8 grid w-full grid-cols-1 gap-4 md:grid-cols-3">
        {STEPS.map((s) => (
          <li key={s.ordinal} className="border-2 border-dashed border-ink bg-paper px-5 py-6 text-center">
            <p className="font-mono text-[12px] font-bold uppercase tracking-[.2em] text-red-deep">{s.ordinal}</p>
            <p className="mt-1.5 font-display text-2xl font-bold uppercase leading-[.95] text-ink md:text-3xl">
              {s.star && <span aria-hidden="true">★ </span>}
              {s.move}
            </p>
          </li>
        ))}
      </ol>
      <p className="mt-8 font-mono text-[11px] font-bold uppercase tracking-[.16em]">
        What you&rsquo;ll see on your screen
      </p>
      <div className="mt-2">
        <BrowserReplica />
      </div>
      <p className="mx-auto mt-10 w-full max-w-3xl text-center font-display text-2xl font-bold uppercase leading-tight md:text-3xl">
        Play first, claim later — your life is tracked from your first spawn.
      </p>
    </section>
  );
}
