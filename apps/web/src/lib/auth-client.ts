"use client";
import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

// createAuthClient needs an ABSOLUTE baseURL at module-init; a relative "/api/auth"
// throws `BetterAuthError: Invalid base URL` during `next build` SSR/prerender (no window).
// Server-side this value is never used for real requests (the react client runs only in the
// browser); it just has to be a valid absolute URL so createAuthClient() doesn't throw at init.
const baseURL =
  (typeof window === "undefined"
    ? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
    : window.location.origin) + "/api/auth";

export const authClient = createAuthClient({
  baseURL,
  plugins: [magicLinkClient()],
});
export const { signIn, signOut, useSession } = authClient;
