"use client";
import { useState } from "react";
import { useFriendActions, useFriendStatus } from "@/lib/use-friends";
import type { FriendStatusValue } from "@/lib/types";

const DAY_MS = 86_400_000;

/** Whole days remaining, floored (never rounded up past the actual wait) and floored at
 *  1 — "in 0 days" is never a useful thing to read. */
export function friendButtonLabel(
  status: FriendStatusValue, cooldownUntil: string | null, now: Date,
): string {
  if (status !== "cooldown" || !cooldownUntil) return "";
  const days = Math.max(1, Math.floor((new Date(cooldownUntil).getTime() - now.getTime()) / DAY_MS));
  return `You can send another request in ${days} ${days === 1 ? "day" : "days"}`;
}

const BTN = "font-mono text-[11px] uppercase tracking-[.05em] border border-ink px-3 py-1.5 " +
  "hover:bg-ink hover:text-paper disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink";

export type FriendViewProps = {
  /** Absent means "nothing to show" — the control renders nothing at all. */
  status?: FriendStatusValue;
  cooldownUntil?: string | null;
  now?: Date;
  loading?: boolean;
  error?: boolean;
  pending?: boolean;
  confirming?: boolean;
  onAdd: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onRemove: () => void;
  onConfirmToggle?: () => void;
};

/**
 * Presentational. Loading and error are NEVER rendered as an authoritative "not friends" —
 * the live-data-honesty invariant. A skeleton and a status line are honest; a default
 * "Add friend" against an unknown relationship is not.
 */
export function FriendView(p: FriendViewProps) {
  if (p.loading) {
    return <div aria-busy="true" aria-hidden className="h-7 w-28 motion-safe:animate-pulse bg-bone" />;
  }
  if (p.error) {
    return (
      <p role="status" className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
        Couldn&apos;t load friend status
      </p>
    );
  }
  if (!p.status) return null;

  if (p.status === "cooldown") {
    const label = friendButtonLabel(p.status, p.cooldownUntil ?? null, p.now ?? new Date());
    return <button type="button" disabled className={BTN}>{label}</button>;
  }
  if (p.status === "incoming") {
    return (
      <div className="flex gap-2">
        <button type="button" onClick={p.onAccept} disabled={p.pending} className={BTN}>Accept</button>
        <button type="button" onClick={p.onDecline} disabled={p.pending} className={BTN}>Decline</button>
      </div>
    );
  }
  if (p.status === "outgoing") {
    return (
      <button type="button" onClick={p.onRemove} disabled={p.pending} className={BTN}>Cancel request</button>
    );
  }
  if (p.status === "friends") {
    // Two steps, because in a follow-up sub-project removing a friend silently revokes
    // location-sharing consent — this is deliberate friction, not an oversight.
    return p.confirming ? (
      <button type="button" onClick={p.onRemove} disabled={p.pending} className={`${BTN} text-red-deep border-red-deep`}>
        Remove friend
      </button>
    ) : (
      <button type="button" onClick={p.onConfirmToggle} className={BTN}>Friends ✓</button>
    );
  }
  return <button type="button" onClick={p.onAdd} disabled={p.pending} className={BTN}>Add friend</button>;
}

/** Container. Renders nothing for a signed-out, unlinked or pending viewer (useFriendStatus
 *  only fetches when verified). */
export function FriendButton({ gamertag }: { gamertag: string }) {
  const { data, loading, error } = useFriendStatus(gamertag);
  const a = useFriendActions();
  const [confirming, setConfirming] = useState(false);

  return (
    <FriendView
      status={data?.status}
      cooldownUntil={data?.cooldownUntil ?? null}
      loading={loading}
      error={error}
      pending={a.pending}
      confirming={confirming}
      onConfirmToggle={() => setConfirming(true)}
      onAdd={() => a.sendRequest(gamertag)}
      onAccept={() => data?.friendshipId && a.acceptRequest(data.friendshipId)}
      onDecline={() => data?.friendshipId && a.declineRequest(data.friendshipId)}
      onRemove={() => {
        if (data?.friendshipId) a.removeFriend(data.friendshipId);
        setConfirming(false);
      }}
    />
  );
}
