"use client";
import { useState } from "react";
import { useSession } from "@/lib/auth-client";
import { useGamertagLinks } from "@/lib/use-gamertag-links";
import { activeLink } from "@/lib/active-link";
import { AvatarPanel } from "@/components/account/avatar-panel";

/**
 * Owner-only avatar management on the dossier (avatar-account-pass spec §5) — the home of the
 * deleted /you page's AvatarPanel. The gate mirrors self-unban-button.tsx's: signed-in + VERIFIED
 * link matching this page. It gates the FETCH too (useGamertagLinks enabled on session), so
 * strangers cost nothing and see nothing — no flash while identity resolves.
 */
export function OwnerAvatar({ pageGamertag }: { pageGamertag: string }) {
  const { data: session } = useSession();
  const links = useGamertagLinks(!!session?.user);
  const link = activeLink(links.data);
  const [openPanel, setOpenPanel] = useState(false);

  const isOwner = !!session?.user && link?.status === "verified" && link.gamertag === pageGamertag;
  if (!isOwner) return null;

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpenPanel((v) => !v)}
        aria-expanded={openPanel}
        className="border-b-2 border-red font-display text-sm font-semibold uppercase tracking-[.06em] text-ink hover:text-red"
      >
        Update photo {openPanel ? "↑" : "↓"}
      </button>
      {openPanel && (
        <div className="mt-3 max-w-md">
          <AvatarPanel />
        </div>
      )}
    </div>
  );
}
