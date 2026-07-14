import Link from "next/link";
import { cn } from "@/lib/utils";
import type { AccountStatus } from "@/lib/account-status";

const cta = "ml-auto inline-flex items-center justify-center rounded-md bg-amber px-4 py-2 text-sm font-medium text-black hover:opacity-90";
const account = "ml-auto text-sm text-dim underline decoration-line underline-offset-4 hover:text-amber";

export function MastheadSlot({ status }: { status: AccountStatus }) {
  if (status.kind === "loading") {
    return (
      <span className={cn(cta, "pointer-events-none opacity-50")} role="status" aria-live="polite">
        <span aria-hidden>…</span>
        <span className="sr-only">Loading account</span>
      </span>
    );
  }
  if (status.kind === "signedOut") return null;
  if (status.kind === "verified") {
    return <Link href="/account" className={cta}>{status.link.gamertag}</Link>;
  }
  // unlinked | pending → quiet account link (the banner carries the primary action)
  return <Link href="/account" className={account}>Account</Link>;
}
