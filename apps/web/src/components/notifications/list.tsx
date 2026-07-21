import type { AppNotification } from "@/lib/types";
import { NotificationRow } from "./row";

/** Rows + empty state + optional load-older. Props-only; the container supplies the frozen
 *  unread set (useNotificationSeen) and the pagination callbacks (useNotifications). */
export function NotificationList({
  items, unreadIds, now, onDark = false, compact = false, hasMore = false, onLoadMore, loadingMore = false,
}: {
  items: AppNotification[];
  unreadIds: Set<number>;
  now: Date;
  onDark?: boolean;
  compact?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  loadingMore?: boolean;
}) {
  if (items.length === 0) {
    return (
      <p className={`font-mono text-[11px] uppercase tracking-[.05em] ${onDark ? "text-cream-muted" : "text-ink-muted"}`}>
        Nothing on the wire.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <ul role="list" className="m-0 flex list-none flex-col gap-1.5 p-0">
        {items.map((n) => (
          <li key={n.id}>
            <NotificationRow n={n} unread={unreadIds.has(n.id)} onDark={onDark} compact={compact} now={now} />
          </li>
        ))}
      </ul>
      {hasMore && onLoadMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loadingMore}
          className={`mt-0.5 text-left font-mono text-[11px] uppercase tracking-[.06em] underline disabled:no-underline disabled:opacity-60 ${
            compact ? "self-start" : "min-h-[44px] w-full"
          } ${onDark ? "text-cream-muted hover:text-paper" : "text-ink-muted hover:text-ink"}`}
        >
          {loadingMore ? "Loading…" : "Load older"}
        </button>
      )}
    </div>
  );
}
