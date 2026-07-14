"use client";
import { useSession } from "./auth-client";
import { useGamertagLinks } from "./use-gamertag-links";
import { accountStatus, type AccountStatus } from "./account-status";

/** Derived onboarding status from the live session + links query. */
export function useAccountStatus(): AccountStatus {
  const { data: session, isPending } = useSession();
  const signedIn = !!session?.user;
  const links = useGamertagLinks(signedIn);
  const loading = isPending || (signedIn && links.isLoading);
  return accountStatus({ signedIn, loading, links: links.data });
}
