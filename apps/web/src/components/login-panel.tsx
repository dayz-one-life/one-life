"use client";
import { LoginForm } from "./login-form";
import { signIn } from "@/lib/auth-client";

/** Client wiring for the login page: binds Better Auth calls to the enabled methods. */
export function LoginPanel({ providers, magicLink }: { providers: string[]; magicLink: boolean }) {
  return (
    <LoginForm
      providers={providers}
      magicLink={magicLink}
      onMagicLink={async (email) => {
        await signIn.magicLink({ email, callbackURL: "/account" });
      }}
      onSocial={(provider) => {
        void signIn.social({ provider: provider as "discord" | "google" | "github", callbackURL: "/account" });
      }}
    />
  );
}
