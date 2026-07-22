"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { getFriendMap } from "@/lib/api";
import { useAccountStatus } from "@/lib/use-account-status";
import type { FriendMap } from "@/lib/types";
import FriendsMap from "./friends-map";

const NOTE = "font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted";

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
      <p role="status" className={NOTE}>
        <Link href="/login" className="font-bold text-red-deep underline">Sign in</Link>
        {" "}to see where your friends are.
      </p>
    );
  }
  if (p.unverified) {
    return <p role="status" className={NOTE}>Verify your gamertag to use the map.</p>;
  }
  if (p.loading) {
    return (
      <div aria-busy="true" className="h-full">
        <div aria-hidden className="h-full min-h-[420px] w-full motion-safe:animate-pulse bg-bone" />
      </div>
    );
  }
  if (p.error) {
    return <p role="status" className={NOTE}>Couldn&apos;t load the map.</p>;
  }
  if (!p.data) return null;
  return <FriendsMap data={p.data} now={p.now} />;
}

export function MapPage({ slug }: { slug: string }) {
  const account = useAccountStatus();
  const verified = account.kind === "verified";
  const q = useQuery({
    queryKey: ["friend-map", slug],
    queryFn: () => getFriendMap(slug),
    enabled: verified,
    refetchInterval: 30_000,
  });

  return (
    <MapPageView
      signedOut={account.kind === "signedOut"}
      unverified={account.kind === "unlinked" || account.kind === "pending"}
      loading={account.kind === "loading" || (verified && q.isPending)}
      error={q.isError && !q.data}
      data={q.data}
      now={new Date()}
    />
  );
}
