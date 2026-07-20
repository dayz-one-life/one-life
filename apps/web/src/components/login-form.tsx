"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";

const PROVIDERS = ["discord", "google", "github"] as const;

export function LoginForm({
  providers,
  magicLink,
  onMagicLink,
  onSocial,
}: {
  providers: string[];
  magicLink: boolean;
  onMagicLink: (email: string) => Promise<void>;
  onSocial: (provider: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await onMagicLink(email);
      setSent(true);
    } catch {
      setError("Could not send the link. Try again.");
    }
  }

  const socials = PROVIDERS.filter((p) => providers.includes(p));
  const nothingConfigured = !magicLink && socials.length === 0;

  return (
    <div className="bg-dark p-6">
      {nothingConfigured && (
        <p className="font-mono text-xs uppercase tracking-[.04em] text-cream-muted">
          No sign-in methods are currently available.
        </p>
      )}
      {socials.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {socials.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onSocial(p)}
              className={cn(
                "-skew-x-[5deg] px-5 py-3 text-center font-display text-sm font-bold uppercase tracking-[.08em]",
                p === "discord" ? "bg-discord text-white hover:opacity-90" : "border border-paper text-paper hover:bg-paper hover:text-ink",
              )}
            >
              Continue with {p}
            </button>
          ))}
        </div>
      )}
      {magicLink && socials.length > 0 && (
        <div className="my-5 flex items-center gap-3" aria-hidden>
          <span className="h-px flex-1 bg-dark-line" />
          <span className="font-mono text-[10px] uppercase text-cream-muted">or</span>
          <span className="h-px flex-1 bg-dark-line" />
        </div>
      )}
      {magicLink &&
        (sent ? (
          <p className="border border-dark-line px-4 py-3 font-mono text-xs uppercase leading-relaxed tracking-[.04em] text-cream-dim">
            Check your email for a sign-in link.
          </p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-2.5">
            <label className="font-mono text-[10px] uppercase tracking-[.06em] text-cream-muted" htmlFor="email">
              Email
            </label>
            <div className="flex gap-2">
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="YOU@EXAMPLE.COM"
                className="min-w-0 flex-1 border border-dark-line bg-dark-well px-3 py-2.5 font-mono text-xs text-paper outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red placeholder:text-cream-muted focus:border-paper"
              />
              <button
                type="submit"
                className="-skew-x-[5deg] bg-paper px-4 py-2 font-display text-[13px] font-bold uppercase tracking-[.06em] text-ink hover:opacity-90"
              >
                Send link
              </button>
            </div>
            {error && (
              <p role="alert" className="font-mono text-[10.5px] uppercase tracking-[.04em] text-red-soft">
                {error}
              </p>
            )}
          </form>
        ))}
    </div>
  );
}
