"use client";
import { useAccountStatus } from "@/lib/use-account-status";
import type { ServersView } from "@/components/servers/how-to-connect";
import { ClaimCta, type PitchAudience } from "./hero";

/**
 * Beat 4 — the CTA slab (cold-home-relaunch spec §2; audience-aware since home-polish spec §3).
 * Replaces ColdFork: ONE ask, twice answered — sign in, or play first via the server browser.
 * Cold: renders for `signedOut` only — nothing renders while identity resolves, so a signed-in
 * player never sees a sign-in pitch flash. Unverified: the PARENT (`UnverifiedPitch`) owns the
 * gate on unlinked/pending — gating here too would double-gate and this slab would never render.
 */
export function CtaSlab({ audience = "cold" }: { servers: ServersView; audience?: PitchAudience }) {
  const status = useAccountStatus();
  if (audience === "cold" && status.kind !== "signedOut") return null;

  return (
    <section aria-label="Claim your life" className="bg-dark px-6 py-12 text-center text-paper md:px-10 md:py-14">
      <h2 className="font-display text-4xl font-bold uppercase leading-none md:text-5xl">
        You get one life. <span className="text-red">Claim it</span>
      </h2>
      <p className="mt-3 font-mono text-xs uppercase tracking-[.1em] text-cream-dim">
        {audience === "unverified"
          ? "You're signed in · Link your gamertag · Your life shows up here"
          : "Sign in · Link your gamertag · Your life shows up here"}
      </p>
      <div className="mt-7">
        <ClaimCta large {...(audience === "unverified" ? { href: "#claim", label: "Link your gamertag →" } : {})} />
      </div>
    </section>
  );
}
