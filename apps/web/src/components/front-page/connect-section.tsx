import { HowToConnect, type ServersView } from "@/components/servers/how-to-connect";

/** The page's last content block for pitch audiences (home-polish spec §5): light, full-width —
 *  so the document ends light-content → dark footer with no dark-slab/light-sliver sandwich.
 *  The heading copy moved here from the slab's old connect box.
 *
 *  ⚠️ No `aria-label` on this outer `<div>` — `HowToConnect` already renders its own
 *  `aria-label="How to connect"` section, and a wrapping labelled landmark around it would
 *  duplicate the landmark. Keep exactly one. */
export function ConnectSection({ servers }: { servers: ServersView }) {
  return (
    <div className="px-6 py-10 md:px-10">
      <p className="font-mono text-[11px] uppercase tracking-[.16em] text-ink-muted">
        Play first, claim later — no account needed to play
      </p>
      <div className="mt-3 max-w-lg">
        <HowToConnect servers={servers} />
      </div>
    </div>
  );
}
