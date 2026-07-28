/** Beat 3 — the rules of the game (cold-home-relaunch spec §2). Static copy; the missing
 *  "how it works" a cold visitor needs before the CTA lands. */
const RULES = [
  { n: "Rule 01", title: "One life", body: "Your survival is tracked to the minute, across every session. The record is public and permanent." },
  { n: "Rule 02", title: "Death is real", body: "Die and you are banned from that server for 24 hours. No respawns. No exceptions." },
  { n: "Rule 03", title: "Earn your way back", body: "Unban tokens buy you back in early. Earn them by verifying, surviving, and recruiting. Spend them wisely." },
] as const;

export function Rules() {
  return (
    <section aria-label="The rules" className="border-y-[3px] border-ink bg-bone">
      <ul role="list" className="grid md:grid-cols-3">
        {RULES.map((r) => (
          <li key={r.n} className="border-b border-hairline p-6 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0">
            <p className="font-mono text-[10px] uppercase tracking-[.2em] text-red-deep">{r.n}</p>
            <h3 className="mt-1.5 font-display text-xl font-bold uppercase">{r.title}</h3>
            <p className="mt-2 font-sans text-sm leading-relaxed text-ink-soft">{r.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
