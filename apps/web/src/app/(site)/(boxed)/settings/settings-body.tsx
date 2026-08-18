"use client";
import Link from "next/link";
import { useAccountStatus } from "@/lib/use-account-status";
import { BlockedUsers } from "@/components/account/blocked-users";
import { DangerZone } from "@/components/account/danger-zone";

/**
 * The settings route's body. `/settings` is a public URL (only the NAV LINK to it is behind the
 * signed-in branch — the route itself isn't), so a signed-out visitor lands here directly and
 * must not see `DangerZone`: it lets them "confirm" a delete, then the server 401s on
 * `getTokens` with a confusing failure. Nothing is destroyed (the server is authoritative), but
 * it's a broken screen on a URL anyone can hit. Pattern matches `account-panels.tsx`'s
 * `signedOut` branch.
 */
export function SettingsBody() {
  const status = useAccountStatus();

  if (status.kind === "loading") return null;

  if (status.kind === "signedOut") {
    return (
      <p className="mt-6 font-mono text-[12px] uppercase tracking-[.05em] text-ink-muted">
        Sign in to manage your account.{" "}
        <Link href="/login" className="font-bold text-red-deep underline">
          Sign in →
        </Link>
      </p>
    );
  }

  return (
    <>
      <BlockedUsers />
      <DangerZone />
    </>
  );
}
