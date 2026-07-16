import Link from "next/link";
import { cn } from "@/lib/utils";
import type { AccountStatus } from "@/lib/account-status";
import { playerSlug } from "@/lib/slug";

const cta = "font-mono text-xs font-bold uppercase tracking-[.06em] text-paper border-b-2 border-red hover:text-red";
const account = "font-mono text-xs uppercase tracking-[.06em] text-cream-dim hover:text-paper";

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
    return <Link href={`/players/${playerSlug(status.link.gamertag)}`} className={cta}>{status.link.gamertag}</Link>;
  }
  // unlinked | pending → quiet account link (the banner carries the primary action)
  return <Link href="/account" className={account}>Account</Link>;
}
