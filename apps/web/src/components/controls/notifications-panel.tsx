"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AppNotification } from "@/lib/types";

export function relativeTime(iso: string, now: Date): string {
  const ms = now.getTime() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

const RED = new Set(["ban_applied", "obituary_published"]);
const BLUE = new Set(["ban_lifted", "life_qualified", "survival_milestone", "birth_notice_published"]);

/** Reuses the R5b/R5c convention: red for death and the Morgue, blue for life and the
 *  Nursery, ink for account bookkeeping. An unknown kind falls back to ink rather than
 *  throwing, so a future notification type degrades quietly. */
export function accentFor(kind: string): string {
  if (RED.has(kind)) return "border-l-red";
  if (BLUE.has(kind)) return "border-l-blue";
  return "border-l-ink";
}

export function NotificationsPanel({
  items, unreadCount, onOpen, hasMore = false, onLoadMore, loadingMore = false, children,
}: {
  items: AppNotification[];
  unreadCount: number;
  /** Receives the ids of the unread notifications this panel actually put on screen.
   *  Anything deeper in the backlog must stay unread — the feed is paginated and the
   *  user has not seen it. */
  onOpen: (ids: number[]) => void;
  /** Whether older, unloaded pages remain. */
  hasMore?: boolean;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // The ids already handed to onOpen. This replaces an earlier once-per-mount boolean, which
  // had the effect of making everything past the first page permanently unreadable: pages
  // loaded after the panel was expanded were rendered but never reported, so their rows sat
  // unread forever and the badge could not reach zero. Tracking ids instead of "did we fire"
  // keeps the guarantee that matters — report each row at most once — while letting rows that
  // arrive later still count as seen.
  const sent = useRef<Set<number>>(new Set());
  // Call sites pass an inline arrow, so onOpen changes identity every render; keep the latest
  // in a ref so the effect below can depend on the rendered items alone.
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  });
  const now = new Date();

  // Marking read follows what is on screen, not a single moment in time.
  useEffect(() => {
    if (!open) return;
    const unreadIds = items.filter((n) => !n.readAt && !sent.current.has(n.id)).map((n) => n.id);
    // Nothing new to mark means nothing to send: a read-only glance costs no request.
    if (unreadIds.length === 0) return;
    for (const id of unreadIds) sent.current.add(id);
    onOpenRef.current(unreadIds);
  }, [open, items]);

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between border-b-[3px] border-ink pb-1.5 font-display text-[13px] font-bold uppercase tracking-[.14em] text-ink"
      >
        <span>Notifications</span>
        {unreadCount > 0 && (
          <span
            data-testid="unread-badge"
            className="min-w-[20px] bg-red px-1.5 py-0.5 text-center font-mono text-[11px] font-bold text-paper"
          >
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-1.5">
          {items.length === 0 ? (
            <p className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
              Nothing on the wire.
            </p>
          ) : (
            items.map((n) => (
              <Link
                key={n.id}
                href={n.href}
                className={`border-l-[3px] ${accentFor(n.kind)} py-1 pl-2.5 ${n.readAt ? "" : "bg-bone"}`}
              >
                <span className="block font-display text-[12px] font-bold uppercase tracking-[.06em] text-ink">
                  {n.title}
                </span>
                <span className="block text-[13px] text-ink">{n.body}</span>
                <span className="block font-mono text-[10px] uppercase tracking-[.05em] text-ink-muted">
                  {relativeTime(n.createdAt, now)}
                </span>
              </Link>
            ))
          )}
          {hasMore && onLoadMore && (
            // The whole reason the backlog is reachable. Each press loads the next page,
            // which the effect above then marks read — so a user with any depth of unread
            // can drain the badge to zero by pressing until it disappears.
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loadingMore}
              className="mt-0.5 self-start font-mono text-[10px] uppercase tracking-[.06em] text-ink-muted underline hover:text-ink disabled:no-underline disabled:opacity-60"
            >
              {loadingMore ? "Loading…" : "Load older"}
            </button>
          )}
          {children}
        </div>
      )}
    </section>
  );
}
