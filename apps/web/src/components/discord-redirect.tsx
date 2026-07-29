"use client";
import { useEffect, useRef } from "react";
import { signIn } from "@/lib/auth-client";

/** True only when Discord is the sole way in — any other configuration (dev magic-link, extra
 *  providers, a FAILED providers fetch) keeps the button page (home-polish spec §7). */
export function isDiscordOnly(methods: { providers: string[]; magicLink: boolean } | null): boolean {
  return !!methods && !methods.magicLink && methods.providers.length === 1 && methods.providers[0] === "discord";
}

const go = () => void signIn.social({ provider: "discord", callbackURL: "/welcome" });

/** Renders instead of the login panel when Discord is the only method: fires the OAuth redirect
 *  immediately, with a real fallback control so a blocked redirect is never a dead end. */
export function DiscordRedirect() {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; // StrictMode double-invoke guard — one redirect, not two
    fired.current = true;
    go();
  }, []);
  return (
    <div className="flex flex-col items-start gap-4">
      <p aria-live="polite" className="font-sans text-base text-ink-soft">Redirecting to Discord…</p>
      <button
        type="button"
        onClick={go}
        className="-skew-x-[5deg] bg-discord px-5 py-3 font-display text-sm font-bold uppercase tracking-[.08em] text-white hover:opacity-90"
      >
        Continue to Discord →
      </button>
    </div>
  );
}
