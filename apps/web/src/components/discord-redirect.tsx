"use client";
import { useEffect, useRef, useState } from "react";
import { signIn } from "@/lib/auth-client";

// ⚠️ `isDiscordOnly` deliberately does NOT live here — it moved to `@/lib/discord-only`.
// `login/page.tsx` is a server component and CALLS it, which is illegal across the RSC boundary
// from a "use client" module and 500'd every /login request in v0.57.0. Do not move it back.

const go = () => void signIn.social({ provider: "discord", callbackURL: "/welcome" });

/** Renders instead of the login panel when Discord is the only method: fires the OAuth redirect
 *  immediately, with a real fallback control so a blocked redirect is never a dead end. */
export function DiscordRedirect() {
  const fired = useRef(false);
  // The live region starts EMPTY and is filled inside the same effect that fires the redirect —
  // a screen reader must already be subscribed to the region before its content changes, or the
  // change is never announced. Text present at initial render (the old behavior) never announces:
  // there is no "change" for the region to notice.
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (fired.current) return; // StrictMode double-invoke guard — one redirect, not two
    fired.current = true;
    setMessage("Redirecting to Discord…");
    go();
  }, []);
  return (
    <div className="flex flex-col items-start gap-4">
      <p aria-live="polite" className="font-sans text-base text-ink-soft">{message}</p>
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
