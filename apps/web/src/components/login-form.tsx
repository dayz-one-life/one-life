"use client";
import { useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const PROVIDERS = ["discord", "google", "github"] as const;

export function LoginForm({
  onMagicLink, onSocial,
}: { onMagicLink: (email: string) => Promise<void>; onSocial: (provider: string) => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try { await onMagicLink(email); setSent(true); }
    catch { setError("Could not send the link. Try again."); }
  }

  return (
    <div className="mx-auto max-w-sm space-y-6">
      <h1 className="text-2xl font-bold">Sign in</h1>
      {sent ? (
        <p className="rounded border border-line bg-panel-2 p-3 text-sm">Check your email for a sign-in link.</p>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm" htmlFor="email">Email</label>
          <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" className="w-full">Send magic link</Button>
          {error && <p role="alert" className="text-sm text-blood">{error}</p>}
        </form>
      )}
      <div className="space-y-2">
        {PROVIDERS.map((p) => (
          <Button key={p} type="button" className="w-full bg-panel-2 text-bone capitalize" onClick={() => onSocial(p)}>
            Continue with {p}
          </Button>
        ))}
      </div>
    </div>
  );
}
