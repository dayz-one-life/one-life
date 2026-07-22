"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { getMapServers } from "@/lib/api";
import { useAccountStatus } from "@/lib/use-account-status";
import type { MapServerDto } from "@/lib/types";

const NOTE = "font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted";

export type ServerPickerViewProps = {
  servers?: MapServerDto[];
  loading?: boolean;
  error?: boolean;
  signedOut?: boolean;
  unverified?: boolean;
};

/** Presentational. Five states, never collapsed — an empty list and a failed fetch are
 *  different statements, and neither is "no servers exist". */
export function ServerPickerView(p: ServerPickerViewProps) {
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
      <div aria-busy="true" className="flex flex-col gap-2">
        <div aria-hidden className="h-12 motion-safe:animate-pulse bg-bone" />
        <div aria-hidden className="h-12 motion-safe:animate-pulse bg-bone" />
      </div>
    );
  }
  if (p.error) {
    return <p role="status" className={NOTE}>Couldn&apos;t load the servers.</p>;
  }
  if (!p.servers) return null;
  if (p.servers.length === 0) {
    return <p className={NOTE}>No active servers.</p>;
  }
  return (
    <ul role="list" className="flex flex-col">
      {p.servers.map((s) => (
        <li key={s.slug} className="border-b border-hairline">
          <Link
            href={`/maps/${s.slug}`}
            className="flex min-h-[44px] items-center justify-between py-2.5 font-mono text-[11px] uppercase tracking-[.05em] text-ink hover:text-red-deep"
          >
            <span className="font-bold">{s.name}</span>
            <span className={NOTE}>
              {s.friendCount === 0
                ? "No friends sharing"
                : `${s.friendCount} sharing`}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ServerPicker() {
  const account = useAccountStatus();
  const verified = account.kind === "verified";
  const q = useQuery({
    queryKey: ["map-servers"],
    queryFn: getMapServers,
    enabled: verified,
    refetchInterval: 60_000,
  });

  return (
    <ServerPickerView
      signedOut={account.kind === "signedOut"}
      unverified={account.kind === "unlinked" || account.kind === "pending"}
      loading={account.kind === "loading" || (verified && q.isPending)}
      error={q.isError && !q.data}
      servers={q.data?.servers}
    />
  );
}
