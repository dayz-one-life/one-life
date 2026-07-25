"use client";
import Link from "next/link";
import { useAccountStatus } from "@/lib/use-account-status";
import { HowToConnect, type ServersView } from "@/components/servers/how-to-connect";

/**
 * The cold (signed-out) home's fork.
 *
 * The highest-intent visitor is someone who ALREADY plays and bounced off the marketing, so they
 * get the first and louder branch. The second branch is for people who have never connected.
 *
 * ⚠️ This renders for `signedOut` only — not for `unlinked`/`pending`. Those visitors are already
 * sold; they get the claim ladder instead, and a pitch on top of it would be noise. It also
 * renders nothing while identity resolves, so a signed-in player never sees a sign-in pitch flash.
 *
 * The referral variant (a visitor arriving via `/j/<code>` seeing one CTA naming their referrer)
 * is sub-project F's — `/j/` does not exist yet.
 */
export function ColdFork({ servers }: { servers: ServersView }) {
  const status = useAccountStatus();
  if (status.kind !== "signedOut") return null;

  return (
    <section aria-label="Get started" className="grid gap-5 px-6 py-8 md:grid-cols-2 md:px-10">
      {/* Centred because the grid stretches both cells to the taller one (the How to connect
       *  panel), and this branch is deliberately much shorter — top-aligned it left a large
       *  empty black field below the CTA. */}
      <div className="flex flex-col justify-center bg-dark p-6">
        <p className="font-display text-[28px] font-bold uppercase leading-none text-paper">
          Already playing?
        </p>
        <p className="mt-2.5 font-mono text-[11.5px] uppercase leading-relaxed tracking-[.03em] text-cream-dim">
          Claim your gamertag and your life shows up here.
        </p>
        <Link
          href="/login"
          // Full width on a phone (a bigger tap target), natural width once the fork is
          // side-by-side — `flex flex-col` stretches children by default.
          className="mt-4 -skew-x-[5deg] bg-paper px-4 py-2 text-center font-display text-[13px] font-bold uppercase tracking-[.08em] text-ink hover:bg-red hover:text-white md:self-start"
        >
          Claim your life →
        </Link>
      </div>

      <div className="border border-hairline bg-white p-6">
        <p className="font-display text-[28px] font-bold uppercase leading-none text-ink">
          New here?
        </p>
        <p className="mt-2.5 font-sans text-base leading-relaxed text-ink-soft">
          You don&rsquo;t need an account to play — just find us in the server browser.
        </p>
        <div className="mt-4">
          <HowToConnect servers={servers} />
        </div>
      </div>
    </section>
  );
}
