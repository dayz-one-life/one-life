"use client";
import { useAccountStatus } from "@/lib/use-account-status";
import { SkewCta } from "@/components/tabloid/skew-cta";

export function SignInCta() {
  const status = useAccountStatus();
  if (status.kind === "loading" || status.kind === "verified") return null;
  return (
    <section className="mx-6 my-10 flex flex-col items-start gap-5 bg-dark p-7 md:mx-10 md:flex-row md:items-center">
      <div className="flex-1">
        <p className="font-display text-3xl font-bold uppercase leading-none text-paper">Get in the paper.</p>
        <p className="mt-2 font-mono text-xs tracking-[.04em] text-cream-muted">
          SIGN IN · LINK YOUR TAG · PERFORM THE EMOTES · TRY NOT TO DIE. FAIL.
        </p>
      </div>
      <SkewCta href="/login">Sign in →</SkewCta>
    </section>
  );
}
