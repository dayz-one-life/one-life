"use client";
import { useState } from "react";
import { useFriendActions, useFriendStatus } from "@/lib/use-friends";
import { useAccountStatus } from "@/lib/use-account-status";
import type { FriendStatusValue } from "@/lib/types";

const DAY_MS = 86_400_000;

/** Whole days remaining, rounded UP — rounding down understates the wait (a 1-day-6-hour
 *  cooldown must never read "in 1 day", or the user retries ~6h early and the server refuses
 *  them) — and floored at 1: "in 0 days" is never a useful thing to read. */
export function friendButtonLabel(
  status: FriendStatusValue, cooldownUntil: string | null, now: Date,
): string {
  if (status !== "cooldown" || !cooldownUntil) return "";
  const days = Math.max(1, Math.ceil((new Date(cooldownUntil).getTime() - now.getTime()) / DAY_MS));
  return `You can send another request in ${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * Maps a failed-mutation error code (already_friends, rate_limited, …) to a short human
 * sentence — never a raw code — so a failed request doesn't just silently re-enable the
 * button. `null`/`undefined` means "nothing to report."
 */
export function friendErrorMessage(code: string | null | undefined): string | null {
  switch (code) {
    case null:
    case undefined:
      return null;
    case "rate_limited":
      return "Too many requests — try again shortly.";
    case "cooldown_active":
      return "You'll need to wait before sending another request.";
    case "already_friends":
      return "You're already friends.";
    case "already_pending":
      return "A request is already pending.";
    case "not_verified":
      return "Only verified players can add friends.";
    case "self_request":
      return "You can't friend yourself.";
    default:
      return "Something went wrong — try again.";
  }
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
  /** Code from the most recently failed action mutation, if any. Mapped through
   *  friendErrorMessage — never rendered raw. */
  errorCode?: string | null;
  onAdd: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onRemove: () => void;
  onConfirmToggle?: () => void;
};

function renderControl(p: FriendViewProps) {
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
    // location-sharing consent — this is deliberate friction, not an oversight. The confirm
    // step still needs a way back out short of navigating away, so Cancel reuses the same
    // toggle that opened it.
    return p.confirming ? (
      <div className="flex gap-2">
        <button type="button" onClick={p.onRemove} disabled={p.pending} className={`${BTN} text-red-deep border-red-deep`}>
          Remove friend
        </button>
        <button type="button" onClick={p.onConfirmToggle} className={BTN}>Cancel</button>
      </div>
    ) : (
      <button type="button" onClick={p.onConfirmToggle} className={BTN}>Friends ✓</button>
    );
  }
  return <button type="button" onClick={p.onAdd} disabled={p.pending} className={BTN}>Add friend</button>;
}

/**
 * Presentational. Loading and error are NEVER rendered as an authoritative "not friends" —
 * the live-data-honesty invariant. A skeleton and a status line are honest; a default
 * "Add friend" against an unknown relationship is not.
 */
export function FriendView(p: FriendViewProps) {
  if (p.loading) {
    // Exposed (not aria-hidden) so the busy state is actually announced — aria-hidden would
    // remove the node from the accessibility tree and make aria-busy pointless. Matches the
    // rail.tsx skeleton pattern: the busy wrapper is exposed, only its decorative inner
    // pulses (none here) would be aria-hidden.
    return <div aria-busy="true" className="h-7 w-28 motion-safe:animate-pulse bg-bone" />;
  }
  if (p.error) {
    return (
      <p role="status" className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
        Couldn&apos;t load friend status
      </p>
    );
  }
  if (!p.status) return null;

  const message = friendErrorMessage(p.errorCode);
  return (
    <div className="flex flex-col items-start gap-1">
      {renderControl(p)}
      {message && (
        <p role="status" className="font-mono text-[11px] uppercase tracking-[.05em] text-red-deep">
          {message}
        </p>
      )}
    </div>
  );
}

/**
 * Container. Renders nothing for a signed-out, unlinked or pending viewer (useFriendStatus
 * only fetches when verified), and nothing on the viewer's own profile — compared
 * case-insensitively against the viewer's own verified gamertag, the only place that
 * identity is available. Whether the TARGET has a verified link is gated at the mount
 * site (player-hero.tsx already carries that flag on the page DTO); this component has no
 * way to distinguish "unverified target" from "ordinary stranger" itself, since the backend
 * deliberately collapses both into status "none".
 */
export function FriendButton({ gamertag }: { gamertag: string }) {
  const account = useAccountStatus();
  const isSelf = account.kind === "verified" &&
    account.link.gamertag.toLowerCase() === gamertag.toLowerCase();
  const { data, loading, error } = useFriendStatus(isSelf ? null : gamertag);
  const a = useFriendActions();
  const [confirming, setConfirming] = useState(false);

  if (isSelf) return null;

  return (
    <FriendView
      status={data?.status}
      cooldownUntil={data?.cooldownUntil ?? null}
      loading={loading}
      error={error}
      pending={a.pending}
      confirming={confirming}
      errorCode={a.errorCode}
      onConfirmToggle={() => setConfirming((c) => !c)}
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
