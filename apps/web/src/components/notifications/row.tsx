import Link from "next/link";
import type { AppNotification } from "@/lib/types";

export function relativeTime(iso: string, now: Date): string {
  const ms = now.getTime() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  // Past a week, a count stops meaning anything — render the dateline instead.
  return new Date(iso)
    .toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    .toUpperCase();
}

const RED = new Set(["ban_applied", "obituary_published"]);
const BLUE = new Set(["ban_lifted", "life_qualified", "survival_milestone", "birth_notice_published"]);

/** R5b/R5c convention: red for death and the Morgue, blue for life and the Nursery, ink for
 *  account bookkeeping. Unknown kinds fall back to ink rather than throwing. */
export function accentFor(kind: string, onDark = false): string {
  if (RED.has(kind)) return "border-l-red";
  if (BLUE.has(kind)) return "border-l-blue";
  // Ink is invisible on bg-dark; paper is the same bookkeeping-neutral there.
  return onDark ? "border-l-paper" : "border-l-ink";
}

/** One notification link row. `unread` comes from the surface's frozen id-set — never from
 *  n.readAt, which the cache stamps mid-glance (spec §5.3). */
export function NotificationRow({
  n, unread, onDark = false, compact = false, now,
}: {
  n: AppNotification;
  unread: boolean;
  onDark?: boolean;
  compact?: boolean;
  now: Date;
}) {
  return (
    <Link
      href={n.href}
      className={`block border-l-[3px] ${accentFor(n.kind, onDark)} ${compact ? "py-1" : "py-2.5"} pl-2.5 pr-2 ${
        unread ? (onDark ? "bg-dark-line" : "bg-bone") : ""
      }`}
    >
      <span className={`block font-display text-[12px] font-bold uppercase tracking-[.06em] ${onDark ? "text-paper" : "text-ink"}`}>
        {n.title}
      </span>
      <span className={`block text-[13px] ${onDark ? "text-paper" : "text-ink"}`}>{n.body}</span>
      <span className={`flex items-center gap-2 font-mono text-[11px] uppercase tracking-[.05em] ${onDark ? "text-cream-muted" : "text-ink-muted"}`}>
        {relativeTime(n.createdAt, now)}
        {unread && <span className={`font-bold ${onDark ? "text-red-soft" : "text-red"}`}>NEW</span>}
      </span>
    </Link>
  );
}
