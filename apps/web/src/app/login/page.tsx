import { LoginPanel } from "@/components/login-panel";
import { getAuthMethods } from "@/lib/api";

export default async function LoginPage() {
  // The methods fetch is server-side to the co-located API; if it fails the API is down,
  // so no sign-in method (magic link included) can actually work. Show an honest unavailable
  // state rather than guessing a method that may be disabled or broken.
  const methods = await getAuthMethods().catch(() => null);
  return (
    <main className="mx-auto max-w-sm p-8">
      {methods ? (
        <LoginPanel providers={methods.providers} magicLink={methods.magicLink} />
      ) : (
        <div className="mx-auto max-w-sm space-y-6">
          <h1 className="text-2xl font-bold">Sign in</h1>
          <p role="alert" className="rounded border border-line bg-panel-2 p-3 text-sm">
            Sign-in is temporarily unavailable. Please try again in a moment.
          </p>
        </div>
      )}
    </main>
  );
}
