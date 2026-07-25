"use client";
import { FriendsPanelContainer } from "@/components/controls/friends-panel";

/**
 * Home's xl-only summary column. Sub-project C replaces its contents (friends online, your
 * standing on the map you are alive on, notifications); B only gives it a home so the friends
 * panel is not lost with the rail.
 *
 * ⚠️ Nothing ACTIONABLE may live only here. This column does not render below xl, so anything
 * reachable solely from it is unreachable on a phone — which is why AccountPanels (claim, verify,
 * tokens, spend) sits in Home's main column instead.
 */
export function HomeSidebar() {
  return (
    <aside
      aria-label="At a glance"
      className="hidden py-8 pl-7 xl:sticky xl:top-0 xl:block xl:max-h-screen xl:self-start xl:overflow-y-auto"
    >
      <FriendsPanelContainer />
    </aside>
  );
}
