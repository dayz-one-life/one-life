"use client";
import { useAccountStatus } from "@/lib/use-account-status";
import { HomeSidebar, type SidebarBoard } from "./home-sidebar";

/**
 * Home's column layout, gated client-side on VERIFIED (cold-home-relaunch spec §3): the xl
 * sidebar is signed-in glance material (friends, standing, notifications), so signedOut/
 * unlinked/pending/loading get a single centered column with no sidebar in the DOM at all.
 * The server cannot distinguish verified from a cookie, so SSR renders the single column and a
 * verified visitor gains the sidebar at hydration — acceptable for xl-only glance content.
 * ⚠️ Nothing actionable may live only in the sidebar (unchanged invariant).
 */
export function HomeShell({ board, children }: { board: SidebarBoard | null; children: React.ReactNode }) {
  const status = useAccountStatus();
  const verified = status.kind === "verified";

  if (!verified) {
    return <main className="mx-auto w-full min-w-0 max-w-5xl">{children}</main>;
  }
  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_380px]">
      <main className="mx-auto w-full min-w-0 max-w-5xl xl:border-r xl:border-ink xl:pr-8">
        {children}
      </main>
      <HomeSidebar board={board} />
    </div>
  );
}
