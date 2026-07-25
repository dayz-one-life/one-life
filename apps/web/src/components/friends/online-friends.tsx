"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getOnlineFriends } from "@/lib/api";
import { useAccountStatus } from "@/lib/use-account-status";
import { mapLabel } from "@/components/player/format";
import type { OnlineFriend } from "@/lib/types";

const OV = "font-mono text-[10px] uppercase tracking-[.12em]";

export type OnlineFriendsView =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "ready"; friends: OnlineFriend[] };

/**
 * "Friends online" per the verified-desktop mock, minus the amendments: no mini-map strip, and no
 * share toggle — sharing lives exclusively on the map's online list (sub-project E), so a friend
 * row only REPORTS the inbound direction ("shares with you" / "not sharing", the same collapsed
 * boolean the map payload discloses).
 *
 * Light surface. Loading, failed and genuinely-empty are three distinct renders.
 */
export function OnlineFriendsPanel({ view }: { view: OnlineFriendsView }) {
  return (
    <section aria-label="Friends online" className="border border-hairline bg-white px-3.5 py-3">
      <div className="flex items-baseline justify-between">
        <h3 className={`${OV} font-bold text-ink`}>
          Friends online{view.kind === "ready" ? ` · ${view.friends.length}` : ""}
        </h3>
        <Link href="/maps" className={`${OV} text-ink-muted hover:text-red`}>
          Map →
        </Link>
      </div>
      {view.kind === "loading" ? (
        <p role="status" className={`${OV} mt-2 text-ink-muted`}>Checking…</p>
      ) : view.kind === "failed" ? (
        <p className={`${OV} mt-2 text-ink-muted`}>Couldn&rsquo;t load friends.</p>
      ) : view.friends.length === 0 ? (
        <p className={`${OV} mt-2 text-ink-muted`}>Nobody is on right now.</p>
      ) : (
        <ul role="list" className="mt-1.5">
          {view.friends.map((f) => (
            <li key={`${f.gamertag}:${f.slug}`} className="flex items-center gap-2.5 border-t border-ink/10 py-2 first:border-t-0">
              <span aria-hidden className="h-[9px] w-[9px] flex-none rounded-full bg-blue" />
              <span className="min-w-0">
                <span className="block truncate font-display text-[13px] font-medium text-ink">{f.gamertag}</span>
                <span className={`${OV} block text-ink-muted`}>
                  {mapLabel(f.map)} · {f.sharing ? "shares with you" : "not sharing"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link href="/friends" className={`${OV} mt-2 block text-ink-muted hover:text-red`}>
        Roster →
      </Link>
    </section>
  );
}

export function OnlineFriendsContainer() {
  const status = useAccountStatus();
  // Verified only: the endpoint 403s for anyone else, and an unverified user has no roster the
  // logs can see anyway.
  const verified = status.kind === "verified";
  const q = useQuery({
    queryKey: ["friends-online"],
    queryFn: getOnlineFriends,
    enabled: verified,
    refetchInterval: 60_000,
  });
  if (!verified) return null;
  const view: OnlineFriendsView = q.isPending
    ? { kind: "loading" }
    : q.isError
      ? { kind: "failed" }
      : { kind: "ready", friends: q.data.friends };
  return <OnlineFriendsPanel view={view} />;
}
