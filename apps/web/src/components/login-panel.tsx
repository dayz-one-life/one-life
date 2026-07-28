"use client";
import Link from "next/link";
import { LoginForm } from "./login-form";
import { signIn } from "@/lib/auth-client";
import { useAccountStatus } from "@/lib/use-account-status";

/** Client wiring for the login page: binds Better Auth calls to the enabled methods. */
export function LoginPanel({ providers, magicLink }: { providers: string[]; magicLink: boolean }) {
  const status = useAccountStatus();

  // `loading` deliberately falls through to the form: most /login visitors are signed out, and
  // a skeleton-then-form flash punishes all of them to spare the rare stale-link visitor a flash
  // the notice replaces a moment later anyway.
  if (status.kind !== "loading" && status.kind !== "signedOut") {
    return (
      <div className="border border-dashed border-dash px-4 py-3">
        <p className="font-mono text-xs uppercase tracking-[.04em] text-ink">You&apos;re already signed in.</p>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
          <Link href="/" className="font-bold text-ink underline hover:text-red">
            Home
          </Link>
          {" · "}
          <Link href="/" className="font-bold text-ink underline hover:text-red">
            Your account
          </Link>
        </p>
      </div>
    );
  }

  return (
    <LoginForm
      providers={providers}
      magicLink={magicLink}
      onMagicLink={async (email) => {
        await signIn.magicLink({ email, callbackURL: "/welcome" });
      }}
      onSocial={(provider) => {
        void signIn.social({ provider: provider as "discord" | "google" | "github", callbackURL: "/welcome" });
      }}
    />
  );
}
