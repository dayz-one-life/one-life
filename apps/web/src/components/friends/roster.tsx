"use client";
import { useState } from "react";
import { GamertagLink } from "@/components/gamertag-link";
import { SrStatus } from "@/components/shared/sr-status";
import { useFriendActions, useFriends } from "@/lib/use-friends";
import type { FriendEntryDto, FriendsFeed } from "@/lib/types";

const BTN = "font-mono text-[11px] uppercase tracking-[.05em] border border-ink px-2.5 py-1 " +
  "hover:bg-ink hover:text-paper disabled:opacity-50";

type RowAction = { label: string; onClick: () => void };

function Row({ entry, actions }: { entry: FriendEntryDto; actions: RowAction[] }) {
  return (
    <li className="flex items-center justify-between border-b border-hairline py-2.5">
      <GamertagLink gamertag={entry.gamertag} />
      <div className="flex gap-2">
        {actions.map((a) => (
          <button key={a.label} type="button" onClick={a.onClick} className={BTN}>{a.label}</button>
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
      <ul aria-labelledby={id} className="mt-2">
        {entries.map((e) => <Row key={e.id} entry={e} actions={action(e)} />)}
      </ul>
    </section>
  );
}

export type RosterViewProps = {
  data?: FriendsFeed;
  loading?: boolean;
  error?: boolean;
  announcement?: string;
  onAccept: (id: number) => void;
  onDecline: (id: number) => void;
  onRemove: (id: number) => void;
};

/** Presentational. Loading, failed and genuinely-empty are three different statements and
 *  are never collapsed into one (live-data-honesty invariant). */
export function RosterView(p: RosterViewProps) {
  if (p.loading) return <p role="status" className="font-mono text-[11px] uppercase text-ink-muted">Loading roster…</p>;
  if (p.error) return <p role="status" className="font-mono text-[11px] uppercase text-ink-muted">Couldn&apos;t load your roster</p>;
  const d = p.data;
  if (!d) return null;

  const empty = d.friends.length === 0 && d.incoming.length === 0 && d.outgoing.length === 0;
  return (
    <div>
      {p.announcement ? <SrStatus>{p.announcement}</SrStatus> : null}
      <Section
        title="Requests" id="roster-incoming" entries={d.incoming}
        action={(e) => [
          { label: "Accept", onClick: () => p.onAccept(e.id) },
          { label: "Decline", onClick: () => p.onDecline(e.id) },
        ]}
      />
      <Section
        title="Friends" id="roster-friends" entries={d.friends}
        action={(e) => [{ label: "Remove", onClick: () => p.onRemove(e.id) }]}
      />
      <Section
        title="Sent" id="roster-outgoing" entries={d.outgoing}
        action={(e) => [{ label: "Cancel", onClick: () => p.onRemove(e.id) }]}
      />
      {empty ? <p className="font-mono text-[11px] uppercase text-ink-muted">No friends yet.</p> : null}
    </div>
  );
}

export function Roster() {
  const { data, loading, error } = useFriends();
  const a = useFriendActions();
  const [announcement, setAnnouncement] = useState("");

  return (
    <RosterView
      data={data ?? undefined}
      loading={loading}
      error={error}
      announcement={announcement}
      onAccept={(id) => { a.acceptRequest(id); setAnnouncement("Friend request accepted"); }}
      onDecline={(id) => { a.declineRequest(id); setAnnouncement("Friend request declined"); }}
      onRemove={(id) => { a.removeFriend(id); setAnnouncement("Removed"); }}
    />
  );
}
