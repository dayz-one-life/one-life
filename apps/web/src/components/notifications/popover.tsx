"use client";
import Link from "next/link";
import type { RefObject } from "react";
import type { AppNotification } from "@/lib/types";
import { NotificationList } from "./list";

/** Dark dropdown chrome around a compact List — hangs off the bg-dark masthead, so the whole
 *  interior uses the on-dark token set (the ⚠️ two-surfaces rule). Page 1 only, by design:
 *  depth lives on /notifications. */
export function NotificationsPopover({
  items, unreadIds, now, error, panelRef,
}: {
  items: AppNotification[];
  unreadIds: Set<number>;
  now: Date;
  error: boolean;
  panelRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Notifications"
      tabIndex={-1}
      className="absolute right-0 top-full z-50 mt-2 w-[340px] border border-dark-line bg-dark p-3 shadow-[0_10px_30px_rgba(0,0,0,.45)]"
    >
      {error ? (
        <p className="font-mono text-[11px] uppercase tracking-[.05em] text-cream-muted">
          Couldn&apos;t reach the wire. Retrying.
        </p>
      ) : (
        <NotificationList items={items} unreadIds={unreadIds} now={now} onDark compact />
      )}
      <div className="mt-2.5 border-t border-dark-line pt-2 text-right">
        <Link
          href="/notifications"
          className="font-mono text-[11px] font-bold uppercase tracking-[.06em] text-cream-muted hover:text-paper"
        >
          View all →
        </Link>
      </div>
    </div>
  );
}
