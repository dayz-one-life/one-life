import { LoginPanel } from "@/components/login-panel";
import { getAuthMethods } from "@/lib/api";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  // The methods fetch is server-side to the co-located API; if it fails the API is down,
  // so no sign-in method (magic link included) can actually work. Show an honest unavailable
  // state rather than guessing a method that may be disabled or broken.
  const methods = await getAuthMethods().catch(() => null);
  return (
    <main className="mx-auto w-full max-w-md px-6 py-12">
      <p className="font-display text-sm font-bold uppercase tracking-[.14em] text-red">The front desk</p>
      <h1 className="mt-1 font-display text-4xl font-bold uppercase leading-[.95] text-ink">Get in the paper.</h1>
      <p className="mt-2 font-mono text-[11.5px] uppercase tracking-[.03em] text-ink-muted">
        Sign in, claim your gamertag, and your deaths make the paper.
      </p>
      <div className="mt-6">
        {methods ? (
          <LoginPanel providers={methods.providers} magicLink={methods.magicLink} />
        ) : (
          <p role="alert" className="border border-dashed border-dash px-4 py-3 font-mono text-xs uppercase tracking-[.04em] text-red-deep">
            Sign-in is temporarily unavailable. Please try again in a moment.
          </p>
        )}
      </div>
    </main>
  );
}
