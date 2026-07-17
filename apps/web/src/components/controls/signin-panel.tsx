import { SkewCta } from "@/components/tabloid/skew-cta";

/** Signed-out rail state: the recruitment pitch (canvas 15a voice). */
export function SignInPanel() {
  return (
    <section className="bg-dark p-5">
      <h2 className="font-display text-[26px] font-bold uppercase leading-none text-paper">Get in the paper.</h2>
      <p className="mt-2.5 font-mono text-[11.5px] uppercase leading-relaxed tracking-[.03em] text-cream-dim">
        Sign in, claim your gamertag, and your deaths make the paper.
      </p>
      <div className="mt-3.5">
        <SkewCta href="/login">Sign in →</SkewCta>
      </div>
    </section>
  );
}
