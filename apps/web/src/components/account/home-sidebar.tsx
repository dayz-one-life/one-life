"use client";
import Link from "next/link";
import { OnlineFriendsContainer } from "@/components/friends/online-friends";
import { relativeTime } from "@/components/notifications/row";
import { useNotifications } from "@/lib/use-notifications";
import { useAccountStatus } from "@/lib/use-account-status";
import { mapLabel, formatDuration } from "@/components/player/format";
import type { SurvivorRow } from "@/lib/types";

/** The board strip Home already resolved server-side (home-is-the-app spec §5). `rows` is the
 *  top of ONE map's board; `failed` keeps a lost fetch distinct from an empty coast. */
export type SidebarBoard = {
  slug: string;
  map: string;
  rows: SurvivorRow[];
  failed: boolean;
};

function BoardBlock({ board }: { board: SidebarBoard }) {
  const status = useAccountStatus();
  const own = status.kind === "verified" ? status.link.gamertag.toLowerCase() : null;
  return (
    <section aria-label={`${mapLabel(board.map)} board`} className="border-t border-hairline pt-2.5">
      <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[.05em]">
        <h3 className="font-bold text-ink">{mapLabel(board.map)} · still alive</h3>
        <Link href={`/survivors/${board.slug}`} className="text-ink-muted hover:text-red">
          All →
        </Link>
      </div>
      {board.failed ? (
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
          Board unreachable right now.
        </p>
      ) : board.rows.length === 0 ? (
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
          Every survivor is dead.
        </p>
      ) : (
        <ol className="mt-2 flex flex-col gap-1.5">
          {board.rows.map((r, i) => {
            const you = own !== null && r.gamertag.toLowerCase() === own;
            return (
              <li
                key={r.gamertag}
                className={`flex items-baseline gap-2 font-mono text-[11px] uppercase tracking-[.04em] ${you ? "font-bold text-ink" : "text-ink-soft"}`}
              >
                <span className="w-4 flex-none text-ink-muted">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">
                  {r.gamertag}
                  {you ? " · you" : ""}
                </span>
                <span className="flex-none tabular-nums">{formatDuration(r.timeAliveSeconds)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function NotificationsBlock() {
  const status = useAccountStatus();
  const n = useNotifications();
  const signedIn = status.kind === "unlinked" || status.kind === "pending" || status.kind === "verified";
  if (!signedIn) return null;
  const latest = n.firstPage.slice(0, 3);
  return (
    <section aria-label="Notifications" className="border-t border-hairline pt-2.5">
      <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[.05em]">
        <h3 className="font-bold text-ink">Notifications</h3>
        <Link href="/notifications" className="text-ink-muted hover:text-red">
          All →
        </Link>
      </div>
      {n.loading ? (
        <p role="status" className="mt-2 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
          Loading…
        </p>
      ) : n.error ? (
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
          Couldn&rsquo;t load notifications.
        </p>
      ) : latest.length === 0 ? (
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
          Nothing yet.
        </p>
      ) : (
        // A passive glance — rendering here does NOT mark rows read (that stays with the bell
        // popover and the inbox, which report only what they rendered).
        <ul role="list" className="mt-2 flex flex-col gap-1.5">
          {latest.map((item) => (
            <li key={item.id} className="font-mono text-[11px] tracking-[.02em]">
              <Link href={item.href} className="block">
                <span className={`block truncate ${item.readAt ? "text-ink-muted" : "font-bold text-ink"}`}>{item.title}</span>
                {/* The body carries the actual subject ("Unforgivn420 is on Livonia.") — a bare
                 *  "Friend online" row is content-free, and three of them are indistinguishable. */}
                <span className="block truncate text-ink-soft">{item.body}</span>
              </Link>
              <span className="text-[10px] uppercase text-ink-muted">{relativeTime(item.createdAt, new Date())}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Home's xl-only summary column: friends, your board standing, notifications (home-is-the-app
 * spec §5 — no mini-map, no morgue/nursery, per the amendments).
 *
 * ⚠️ Nothing ACTIONABLE may live only here. This column does not render below xl, so anything
 * reachable solely from it is unreachable on a phone — which is why AccountPanels (claim, verify,
 * tokens, spend) sits in Home's main column instead, and why each block here is a glance plus an
 * `All →` to a full-width page.
 */
export function HomeSidebar({ board }: { board: SidebarBoard | null }) {
  return (
    <aside
      aria-label="At a glance"
      className="hidden py-8 pl-7 xl:sticky xl:top-0 xl:block xl:max-h-screen xl:self-start xl:overflow-y-auto"
    >
      <div className="flex flex-col gap-5">
        <OnlineFriendsContainer />
        {board && <BoardBlock board={board} />}
        <NotificationsBlock />
      </div>
    </aside>
  );
}
