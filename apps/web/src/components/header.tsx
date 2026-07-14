"use client";
import Link from "next/link";
import { useSession } from "@/lib/auth-client";
import { useGamertagLinks } from "@/lib/use-gamertag-links";
import { activeLink } from "@/lib/active-link";
import { cn } from "@/lib/utils";

const cta = "ml-auto inline-flex items-center justify-center rounded-md bg-amber px-4 py-2 text-sm font-medium text-black hover:opacity-90";

export function Masthead() {
  const { data: session, isPending } = useSession();
  const signedIn = !!session?.user;
  const links = useGamertagLinks(signedIn);
  const loading = isPending || (signedIn && links.isLoading);

  let href = "/login";
  let label = "Sign in";
  if (signedIn) {
    const active = activeLink(links.data);
    if (!active) {
      href = "/account/claim";
      label = "Link gamertag";
    } else {
      href = "/account";
      label = active.status === "pending" ? `${active.gamertag} (not verified)` : active.gamertag;
    }
  }

  return (
    <header className="flex items-center gap-6 border-b border-line bg-panel-2 px-6 py-3">
      <Link href="/" aria-label="One Life — home">
        <img src="/one-life-horizontal.png" alt="One Life" className="h-9 w-auto" />
      </Link>
      {loading ? (
        <span className={cn(cta, "pointer-events-none opacity-50")} role="status" aria-live="polite">
          <span aria-hidden>…</span>
          <span className="sr-only">Loading account</span>
        </span>
      ) : (
        <Link href={href} className={cta}>
          {label}
        </Link>
      )}
    </header>
  );
}
