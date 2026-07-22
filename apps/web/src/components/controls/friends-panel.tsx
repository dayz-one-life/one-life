"use client";
import Link from "next/link";
import { useFriends } from "@/lib/use-friends";

export type FriendsPanelProps = {
  friendCount?: number;
  requestCount?: number;
  loading?: boolean;
  /** True when the fetch failed — the count is unknown and should not render a number. */
  error?: boolean;
  /** True when mounted in the mobile sheet, which is bg-dark. */
  boxed?: boolean;
};

/**
 * Deliberately thin: counts and a link, no list and no controls. The rail is 380px and a
 * friends list grows unbounded; the Roster page owns the list.
 *
 * ⚠️ Mounted on BOTH surfaces — the light rail and the dark sheet — so every colour token
 * here swaps on `boxed`. See friends-panel.test.tsx.
 */
export function FriendsPanel(p: FriendsPanelProps) {
  const text = p.boxed ? "text-paper" : "text-ink";
  const muted = p.boxed ? "text-cream-muted" : "text-ink-muted";
  const border = p.boxed ? "border-dark-line" : "border-hairline";
  const badge = p.boxed ? "bg-red text-paper" : "bg-red-deep text-paper";

  if (p.loading) {
    return (
      <div className={`border-t ${border} pt-2.5 ${text}`}>
        <p role="status" className={`font-mono text-[11px] uppercase tracking-[.05em] ${muted}`}>
          Loading friends…
        </p>
      </div>
    );
  }

  const showCount = typeof p.friendCount === "number";

  return (
    <div className={`border-t ${border} pt-2.5 ${text}`}>
      <Link
        href="/friends"
        className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[.05em] font-bold"
      >
        <span>Friends {showCount && p.friendCount}</span>
        {showCount && p.requestCount ? (
          <span
            aria-label={`${p.requestCount} pending friend requests`}
            className={`${badge} px-1.5 py-0.5`}
          >
            {p.requestCount > 9 ? "9+" : p.requestCount}
          </span>
        ) : null}
      </Link>
    </div>
  );
}

export function FriendsPanelContainer({ boxed }: { boxed?: boolean }) {
  const { data, loading, error } = useFriends();
  // A failed load falls through to the link with no counts rather than a fabricated zero
  // badge — the link still works, which is the panel's whole job.
  return (
    <FriendsPanel
      loading={loading}
      error={error}
      boxed={boxed}
      friendCount={data?.total}
      requestCount={data?.incoming.length}
    />
  );
}
