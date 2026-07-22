"use client";
import { useState } from "react";
import Link from "next/link";
import { GamertagLink } from "@/components/gamertag-link";
import { SrStatus } from "@/components/shared/sr-status";
import { friendErrorMessage } from "./format";
import { FriendsPagination } from "./pagination";
import { useFriendActions, useFriends } from "@/lib/use-friends";
import { useAccountStatus } from "@/lib/use-account-status";
import type { FriendEntryDto, FriendsFeed } from "@/lib/types";

const BTN = "font-mono text-[11px] uppercase tracking-[.05em] border border-ink px-2.5 py-1 " +
  "hover:bg-ink hover:text-paper disabled:opacity-50";
const BTN_DANGER = `${BTN} text-red-deep border-red-deep`;

type RowAction = { label: string; onClick: () => void; danger?: boolean; disabled?: boolean };

function Row({ entry, actions }: { entry: FriendEntryDto; actions: RowAction[] }) {
  return (
    <li className="flex items-center justify-between border-b border-hairline py-2.5">
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
    </li>
  );
}

function Section({ title, id, entries, action }: {
  title: string; id: string; entries: FriendEntryDto[];
  action: (e: FriendEntryDto) => RowAction[];
}) {
  if (entries.length === 0) return null;
  return (
    <section className="mt-8 first:mt-0">
      <h2 id={id} className="font-mono text-[11px] uppercase tracking-[.08em] text-ink-muted">{title}</h2>
      <ul role="list" aria-labelledby={id} className="mt-2">
        {entries.map((e) => <Row key={e.id} entry={e} actions={action(e)} />)}
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
  onPageChange?: (page: number) => void;
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
      />
      {/* Only the friends list is paginated server-side; incoming/outgoing are returned
       *  whole and must never gain a pager. */}
      <FriendsPagination
        page={d.page} total={d.total} pageSize={d.pageSize}
        onPage={p.onPageChange ?? (() => {})}
      />
      <Section
        title="Sent" id="roster-outgoing" entries={d.outgoing}
        action={(e) => [{ label: "Cancel request", onClick: () => p.onRemove(e.id), disabled: p.pending }]}
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
    />
  );
}
