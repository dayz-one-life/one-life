"use client";
import Link from "next/link";
import { useFriends } from "@/lib/use-friends";

export type FriendsPanelProps = {
  /** Absent (rather than `false`/a distinct `error` flag) whenever the count is unknown —
   *  a failed fetch is the only real-world cause (see FriendsPanelContainer), but this
   *  presentational component only ever needs to know whether it HAS a number. */
  friendCount?: number;
  requestCount?: number;
  loading?: boolean;
};

/**
 * Deliberately thin: counts and a link, no list and no controls. The sidebar is 380px and a
 * friends list grows unbounded; the Roster page owns the list.
 *
 * Light surface only. It used to carry a `boxed` variant because it was mounted on both the light
 * rail and the dark ControlsSheet; sub-project B deleted the sheet, so the two-surface token swap
 * this component existed to survive is gone with it.
 */
export function FriendsPanel(p: FriendsPanelProps) {
  const text = "text-ink";
  const muted = "text-ink-muted";
  const border = "border-hairline";
  const badge = "bg-red-deep text-paper";
  const minH = "";

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
        className={`flex items-center justify-between font-mono text-[11px] uppercase tracking-[.05em] font-bold ${minH}`}
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

export function FriendsPanelContainer() {
  const { data, loading } = useFriends();
  // A failed load leaves `data` (and so `friendCount`/`requestCount`) undefined, which falls
  // through to the link with no counts rather than a fabricated zero badge — the link still
  // works, which is the panel's whole job.
  return (
    <FriendsPanel
      loading={loading}
      friendCount={data?.total}
      requestCount={data?.incoming.length}
    />
  );
}
