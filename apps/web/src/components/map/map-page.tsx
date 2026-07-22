"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { getFriendMap, getMapServers } from "@/lib/api";
import { useAccountStatus } from "@/lib/use-account-status";
import type { FriendMap } from "@/lib/types";
import FriendsMap from "./friends-map";
import { TopBar } from "./shell/top-bar";

// ⚠️ DARK SURFACE. The shell has no paper anywhere — these notes sit over the map region, so
// they carry cream/paper tokens, never the light surfaces' `text-ink-muted`.
const NOTE = "font-mono text-[11px] uppercase tracking-[.05em] text-cream-dim";

/** Every non-loaded state renders as a card OVER the map region, with the bar still above it,
 *  so the route is always escapable and a blank canvas never stands in for "nobody is here". */
const CARD = "absolute inset-0 z-10 flex items-center justify-center bg-dark/80 p-6 text-center";

export type MapPageViewProps = {
  data?: FriendMap;
  loading?: boolean;
  error?: boolean;
  signedOut?: boolean;
  unverified?: boolean;
  now: Date;
};

/** Presentational. Five states, never collapsed: signed out, unverified, loading, failed,
 *  loaded. A blank canvas would read as "nobody is here", which is a different claim. */
export function MapPageView(p: MapPageViewProps) {
  if (p.signedOut) {
    return (
      <div className={CARD}>
        <p role="status" className={NOTE}>
          {/* `red-deep` is a LIGHT-surface token; on dark it fails AA. Plain red passes here. */}
          <Link href="/login" className="font-bold text-red underline">Sign in</Link>
          {" "}to see where your friends are.
        </p>
      </div>
    );
  }
  if (p.unverified) {
    return (
      <div className={CARD}>
        <p role="status" className={NOTE}>Verify your gamertag to use the map.</p>
      </div>
    );
  }
  if (p.loading) {
    return (
      <div aria-busy="true" className={CARD}>
        <div aria-hidden className="h-full w-full motion-safe:animate-pulse bg-dark-well" />
      </div>
    );
  }
  if (p.error) {
    return (
      <div className={CARD}>
        <p role="status" className={NOTE}>Couldn&apos;t load the map.</p>
      </div>
    );
  }
  if (!p.data) return null;
  return <FriendsMap data={p.data} now={p.now} />;
}

export function MapPage({ slug }: { slug: string }) {
  const account = useAccountStatus();
  const verified = account.kind === "verified";
  const servers = useQuery({ queryKey: ["map-servers"], queryFn: getMapServers, enabled: verified });
  const q = useQuery({
    queryKey: ["friend-map", slug],
    queryFn: () => getFriendMap(slug),
    enabled: verified,
    refetchInterval: 30_000,
  });

  return (
    <>
      <TopBar slug={slug} servers={servers.data?.servers} serversLoading={servers.isPending} />
      {/* The root layout's skip link points at #main-content, which lives in the (site) layout
          this route deliberately opts out of — so the shell supplies its own target, and it is
          the map region, not the bar the link exists to skip. */}
      <div id="main-content" tabIndex={-1} className="relative min-h-0 flex-1">
        <MapPageView
          signedOut={account.kind === "signedOut"}
          unverified={account.kind === "unlinked" || account.kind === "pending"}
          loading={account.kind === "loading" || (verified && q.isPending)}
          error={q.isError && !q.data}
          data={q.data}
          now={new Date()}
        />
      </div>
    </>
  );
}
