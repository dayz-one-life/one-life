"use client";
import { useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const PROVIDERS = ["discord", "google", "github"] as const;

export function LoginForm({
  providers, magicLink, onMagicLink, onSocial,
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
    try { await onMagicLink(email); setSent(true); }
    catch { setError("Could not send the link. Try again."); }
  }

  // Preserve the canonical display order; show only providers the server configured.
  const socials = PROVIDERS.filter((p) => providers.includes(p));
  const nothingConfigured = !magicLink && socials.length === 0;

  return (
    <div className="mx-auto max-w-sm space-y-6">
      <h1 className="text-2xl font-bold">Sign in</h1>
      {nothingConfigured && (
        <p className="rounded border border-line bg-panel-2 p-3 text-sm">
          No sign-in methods are currently available.
        </p>
      )}
      {magicLink && (sent ? (
        <p className="rounded border border-line bg-panel-2 p-3 text-sm">Check your email for a sign-in link.</p>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm" htmlFor="email">Email</label>
          <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" className="w-full">Send magic link</Button>
          {error && <p role="alert" className="text-sm text-blood">{error}</p>}
        </form>
      ))}
      {socials.length > 0 && (
        <div className="space-y-2">
          {socials.map((p) => (
            <Button key={p} type="button" className="w-full bg-panel-2 text-bone capitalize" onClick={() => onSocial(p)}>
              Continue with {p}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
