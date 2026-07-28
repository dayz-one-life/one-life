"use client";
import { useAccountStatus } from "@/lib/use-account-status";
import { HowToConnect, type ServersView } from "@/components/servers/how-to-connect";
import { ClaimCta } from "./hero";

/**
 * Beat 4 — the CTA slab (cold-home-relaunch spec §2). Replaces ColdFork: ONE ask, twice
 * answered — sign in, or play first via the server browser. Renders for `signedOut` only —
 * unlinked/pending get the claim ladder instead, and nothing renders while identity resolves
 * so a signed-in player never sees a sign-in pitch flash (ColdFork's rule, retained).
 */
export function CtaSlab({ servers }: { servers: ServersView }) {
  const status = useAccountStatus();
  if (status.kind !== "signedOut") return null;

  return (
    <section aria-label="Claim your life" className="bg-dark px-6 py-12 text-center text-paper md:px-10 md:py-14">
      <h2 className="font-display text-4xl font-bold uppercase leading-none md:text-5xl">
        You get one life. <span className="text-red">Claim it</span>
      </h2>
      <p className="mt-3 font-mono text-xs uppercase tracking-[.1em] text-cream-dim">
        Sign in · Link your gamertag · Your life shows up here
      </p>
      <div className="mt-7">
        <ClaimCta large />
      </div>
      <div className="mx-auto mt-9 w-full max-w-lg border border-dark-line bg-dark-well p-5 text-left">
        <p className="font-mono text-[11px] uppercase tracking-[.16em] text-cream-dim">
          Play first, claim later — no account needed to play
        </p>
        <div className="mt-3">
          <HowToConnect servers={servers} onDark />
        </div>
      </div>
    </section>
  );
}
