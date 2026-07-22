"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { GamertagLink } from "@/components/gamertag-link";
import { SrStatus } from "@/components/shared/sr-status";
import { friendErrorMessage } from "./format";
import { FriendsPagination } from "./pagination";
import { MasterShareSwitch, PresenceToggles } from "./presence-toggles";
import { MasterLocationSwitch, LocationToggle } from "./location-toggles";
import { useFriendActions, useFriends } from "@/lib/use-friends";
import { useAccountStatus } from "@/lib/use-account-status";
import type { FriendEntryDto, FriendsFeed } from "@/lib/types";

const BTN = "font-mono text-[11px] uppercase tracking-[.05em] border border-ink px-2.5 py-1 " +
  "hover:bg-ink hover:text-paper disabled:opacity-50";
const BTN_DANGER = `${BTN} text-red-deep border-red-deep`;

type RowAction = { label: string; onClick: () => void; danger?: boolean; disabled?: boolean };

function Row({ entry, actions, extra }: {
  entry: FriendEntryDto; actions: RowAction[]; extra?: ReactNode;
}) {
  return (
    <li className="border-b border-hairline py-2.5">
      <div className="flex items-center justify-between">
        <GamertagLink gamertag={entry.gamertag} />
        <div className="flex gap-2">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={a.onClick}
              disabled={a.disabled}
              className={a.danger ? BTN_DANGER : BTN}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
      {extra}
    </li>
  );
}

function Section({ title, id, entries, action, extra }: {
  title: string; id: string; entries: FriendEntryDto[];
  action: (e: FriendEntryDto) => RowAction[];
  extra?: (e: FriendEntryDto) => ReactNode;
}) {
  if (entries.length === 0) return null;
  return (
    <section className="mt-8 first:mt-0">
      <h2 id={id} className="font-mono text-[11px] uppercase tracking-[.08em] text-ink-muted">{title}</h2>
      <ul role="list" aria-labelledby={id} className="mt-2">
        {entries.map((e) => (
          <Row key={e.id} entry={e} actions={action(e)} extra={extra?.(e)} />
        ))}
      </ul>
    </section>
  );
}

export type RosterViewProps = {
  data?: FriendsFeed;
  loading?: boolean;
  error?: boolean;
  /** True for a visitor who is definitely not signed in — checked before `loading`/`error`, so
   *  a signed-out visitor gets an honest sign-in prompt instead of a permanently blank page
   *  (the query behind `data` is never even enabled for them). */
  signedOut?: boolean;
  announcement?: string;
  /** Human sentence for the most recently FAILED action, already mapped through
   *  friendErrorMessage — the same mapper and the same visible role="status" presentation
   *  FriendView uses, so the two surfaces describe an identical failure identically. */
  errorMessage?: string | null;
  /** Whether any friend-action mutation is currently in flight — disables every row control
   *  so a user can't double-fire accept/decline/remove before the first call resolves. */
  pending?: boolean;
  /** Which friendship id is mid remove-friend confirm, if any — see the Friends section
   *  below. Cancel request (outgoing) is deliberately NOT gated this way. */
  confirmingId?: number | null;
  onConfirmToggle?: (id: number | null) => void;
  onAccept: (id: number) => void;
  onDecline: (id: number) => void;
  onRemove: (id: number) => void;
  /** Withdraw your own un-answered outgoing request. Distinct from `onRemove` — cancelling a
   *  pending request you sent is not the same action as removing an accepted friend, and
   *  should not share its announcement (see FriendButton, which already distinguishes them). */
  onCancel: (id: number) => void;
  onPageChange?: (page: number) => void;
  onPresenceChange?: (id: number, patch: { share?: boolean; notify?: boolean }) => void;
  onSharePresenceChange?: (value: boolean) => void;
  onLocationChange?: (id: number, share: boolean) => void;
  onShareLocationChange?: (value: boolean) => void;
};

/** Presentational. Loading, failed, signed-out and genuinely-empty are all different
 *  statements and are never collapsed into one (live-data-honesty invariant) — "unknown"
 *  (loading/signed-out) must never render as an authoritative negative (an empty roster). */
export function RosterView(p: RosterViewProps) {
  if (p.signedOut) {
    return (
      <p className="font-mono text-[12px] uppercase tracking-[.05em] text-ink-muted">
        Sign in to see your roster.{" "}
        <Link href="/login" className="font-bold text-red-deep underline">
          Sign in →
        </Link>
      </p>
    );
  }
  if (p.loading) return <p role="status" className="font-mono text-[11px] uppercase text-ink-muted">Loading roster…</p>;
  if (p.error) return <p role="status" className="font-mono text-[11px] uppercase text-ink-muted">Couldn&apos;t load your roster</p>;
  const d = p.data;
  if (!d) return null;

  const empty = d.friends.length === 0 && d.incoming.length === 0 && d.outgoing.length === 0;
  const toggleConfirm = p.onConfirmToggle ?? (() => {});
  const onPresenceChange = p.onPresenceChange ?? (() => {});
  const onSharePresenceChange = p.onSharePresenceChange ?? (() => {});
  const onLocationChange = p.onLocationChange ?? (() => {});
  const onShareLocationChange = p.onShareLocationChange ?? (() => {});

  return (
    <div>
      {p.announcement ? <SrStatus>{p.announcement}</SrStatus> : null}
      {p.errorMessage ? (
        <p role="status" className="mb-3 font-mono text-[11px] uppercase tracking-[.05em] text-red-deep">
          {p.errorMessage}
        </p>
      ) : null}
      <Section
        title="Requests" id="roster-incoming" entries={d.incoming}
        action={(e) => [
          { label: "Accept", onClick: () => p.onAccept(e.id), disabled: p.pending },
          { label: "Decline", onClick: () => p.onDecline(e.id), disabled: p.pending },
        ]}
      />
      {empty ? null : (
        <>
          <MasterShareSwitch
            on={d.sharePresence}
            disabled={p.pending}
            onChange={onSharePresenceChange}
          />
          <MasterLocationSwitch
            on={d.shareLocation}
            disabled={p.pending}
            onChange={onShareLocationChange}
          />
        </>
      )}
      <Section
        title="Friends" id="roster-friends" entries={d.friends}
        action={(e) =>
          p.confirmingId === e.id
            ? [
                { label: "Remove friend", onClick: () => p.onRemove(e.id), danger: true, disabled: p.pending },
                { label: "Cancel", onClick: () => toggleConfirm(null) },
              ]
            : [{ label: "Remove", onClick: () => toggleConfirm(e.id), disabled: p.pending }]
        }
        extra={(e) => (
          <>
            <PresenceToggles
              friendshipId={e.id}
              share={e.sharesPresence}
              notify={e.notifyPresence}
              masterOn={d.sharePresence}
              disabled={p.pending}
              onChange={(patch) => onPresenceChange(e.id, patch)}
            />
            <LocationToggle
              friendshipId={e.id}
              share={e.sharesLocation}
              masterOn={d.shareLocation}
              theyShare={e.theyShareLocation}
              disabled={p.pending}
              onChange={(v) => onLocationChange(e.id, v)}
            />
          </>
        )}
      />
      {/* Only the friends list is paginated server-side; incoming/outgoing are returned
       *  whole and must never gain a pager. */}
      <FriendsPagination
        page={d.page} total={d.total} pageSize={d.pageSize}
        onPage={p.onPageChange ?? (() => {})}
      />
      <Section
        title="Sent" id="roster-outgoing" entries={d.outgoing}
        action={(e) => [{ label: "Cancel request", onClick: () => p.onCancel(e.id), disabled: p.pending }]}
      />
      {empty ? <p className="font-mono text-[11px] uppercase text-ink-muted">No friends yet.</p> : null}
    </div>
  );
}

export function Roster() {
  const account = useAccountStatus();
  const [page, setPage] = useState(1);
  const { data, loading, error } = useFriends(page);
  const a = useFriendActions();

  // A removal (decline/cancel/remove) can shrink `total` below what the current page needs —
  // e.g. 26 friends on page 2, remove one, total becomes 25 and page 2 is now empty. `page` is
  // local state with no other feedback loop back to the server total, so without this the
  // Friends section silently renders nothing and FriendsPagination — now genuinely a single
  // page — returns null, stranding the user with no control back to page 1. Clamps only
  // DOWNWARD, and only once real data has actually loaded (never against a stale/loading
  // total, which would be a fabricated clamp).
  useEffect(() => {
    if (!data) return;
    const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
    if (page > totalPages) setPage(totalPages);
  }, [data, page]);
  const [announcement, setAnnouncement] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);

  // Announce only once the mutation has actually settled — never at click time. A failed
  // action never announces success; it surfaces the mapped error text instead (same
  // friendErrorMessage mapper and same visible role="status" presentation as FriendView), so
  // a screen-reader user is never told something happened when it didn't.
  const settle = (successMessage: string) => (ok: boolean, code: string | null) => {
    if (ok) {
      setAnnouncement(successMessage);
      setErrorMessage(null);
    } else {
      setAnnouncement("");
      setErrorMessage(friendErrorMessage(code) ?? "Something went wrong — try again.");
    }
  };

  // "loading" covers both the account-status resolution AND the friends fetch itself — the
  // account status must be known BEFORE we can honestly say "signed out" vs. "loading", or a
  // signed-out visitor flashes as an empty roster while the session resolves.
  const signedOut = account.kind === "signedOut";
  const accountLoading = account.kind === "loading";

  return (
    <RosterView
      data={data ?? undefined}
      loading={accountLoading || loading}
      error={error}
      signedOut={signedOut}
      announcement={announcement}
      errorMessage={errorMessage}
      pending={a.pending}
      confirmingId={confirmingId}
      onConfirmToggle={setConfirmingId}
      onPageChange={setPage}
      onAccept={(id) => a.acceptRequest(id, settle("Friend request accepted"))}
      onDecline={(id) => a.declineRequest(id, settle("Friend request declined"))}
      onRemove={(id) => {
        a.removeFriend(id, settle("Removed"));
        setConfirmingId(null);
      }}
      onCancel={(id) => a.removeFriend(id, settle("Friend request canceled"))}
      onPresenceChange={(id, patch) =>
        a.setPresence(id, patch, settle("Presence updated"))}
      onSharePresenceChange={(value) =>
        a.setSharePresence(value, settle(value ? "Sharing your status" : "No longer sharing your status"))}
      onLocationChange={(id, share) =>
        a.setLocation(id, share, settle("Location updated"))}
      onShareLocationChange={(value) =>
        a.setShareLocation(value, settle(value ? "Sharing your location" : "No longer sharing your location"))}
    />
  );
}
