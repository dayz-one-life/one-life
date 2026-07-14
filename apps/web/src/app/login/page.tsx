"use client";
import { LoginForm } from "@/components/login-form";
import { signIn } from "@/lib/auth-client";

export default function LoginPage() {
  return (
    <main className="mx-auto max-w-sm p-8">
      <LoginForm
        onMagicLink={async (email) => {
          await signIn.magicLink({ email, callbackURL: "/account" });
        }}
        onSocial={(provider) => {
          void signIn.social({ provider: provider as "discord" | "google" | "github", callbackURL: "/account" });
        }}
      />
    </main>
  );
}
