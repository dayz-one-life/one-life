"use client";
import Link from "next/link";
import { useAccountStatus } from "@/lib/use-account-status";
import { useNotifications, useNotificationSeen } from "@/lib/use-notifications";
import { NotificationList } from "./list";
import { PushToggle } from "./push-toggle";

/** The permanent inbox (spec §3.3). Signed out renders a CTA, not a redirect — the URL must
 *  keep working as a push landing target through a session lapse. The page reports every row
 *  it renders (each Load older page included) and nothing deeper. */
export function NotificationsInbox() {
  const status = useAccountStatus();
  const n = useNotifications();
  const seen = useNotificationSeen(n.items, true, n.markRead);
  const now = new Date();

  let body: React.ReactNode;
  if (status.kind === "loading" || n.loading) {
    body = (
      <div aria-busy="true" className="flex flex-col gap-2">
        <div aria-hidden className="h-16 animate-pulse bg-bone" />
        <div aria-hidden className="h-16 animate-pulse bg-bone" />
        <div aria-hidden className="h-16 animate-pulse bg-bone" />
      </div>
    );
  } else if (status.kind === "signedOut") {
    body = (
      <p className="font-mono text-[12px] uppercase tracking-[.05em] text-ink-muted">
        Sign in to read your wire.{" "}
        <Link href="/login" className="font-bold text-red underline">
          Sign in →
        </Link>
      </p>
    );
  } else if (n.error) {
    body = (
      <div className="flex flex-col items-start gap-2">
        <p className="font-mono text-[12px] uppercase tracking-[.05em] text-ink-muted">
          Couldn&apos;t reach the wire. Retrying.
        </p>
        <button
          type="button"
          onClick={n.refetch}
          className="min-h-[44px] font-mono text-[11px] uppercase tracking-[.06em] text-ink-muted underline hover:text-ink"
        >
          Try now
        </button>
      </div>
    );
  } else {
    body = (
      <NotificationList
        items={n.items}
        unreadIds={seen}
        now={now}
        hasMore={n.hasMore}
        onLoadMore={n.loadMore}
        loadingMore={n.loadingMore}
      />
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10 md:px-10">
      <div className="border-b-[3px] border-ink pb-4">
        <h1 className="font-display text-4xl font-bold uppercase tracking-[.02em] text-ink">The Wire</h1>
        <p className="mt-1 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
          Everything that happened to you, on the record.
        </p>
      </div>
      <div className="mt-5">{body}</div>
      {status.kind !== "signedOut" && status.kind !== "loading" && (
        <div className="mt-8 border border-ink p-3.5">
          <h2 className="font-display text-[13px] font-bold uppercase tracking-[.14em] text-ink">Push alerts</h2>
          <PushToggle />
        </div>
      )}
    </main>
  );
}
