"use client";
import Link from "next/link";
import { useState } from "react";
import { useModalBehavior } from "@/lib/use-modal-behavior";

/** Just enough of a server to switch to it. Deliberately NOT `MapServerDto` (the gated
 *  `/me/maps` shape): the switcher is driven by the PUBLIC server list so it works signed out,
 *  and it never showed the friend count anyway — see the note in the menu below. */
export type SwitchableMap = { slug: string; name: string };

/** Current map plus a menu of the others.
 *
 *  ⚠️ This sits on the DARK top bar: paper/cream text and dark-edge borders, never the light
 *  rail's ink tokens. A panel written in `text-ink` renders present, functional and invisible —
 *  and RTL asserts the DOM, not contrast, so only an explicit token test catches it. */
export function MapSwitcher({ slug, servers, loading }: {
  slug: string; servers?: readonly SwitchableMap[]; loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useModalBehavior(open, () => setOpen(false));
  const current = servers?.find((s) => s.slug === slug);
  const label = current?.name ?? slug;

  return (
    <div className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[52px] min-w-0 items-center gap-2 border border-dark-edge px-3 py-1.5 font-display text-base font-bold uppercase tracking-[.06em] text-paper md:min-h-[40px] md:px-3 md:text-base"
      >
        <span className="truncate">{label}</span>
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div
          ref={panelRef}
          role="menu"
          // useModalBehavior focuses the panel; a div with no tabindex silently ignores it.
          tabIndex={-1}
          className="absolute left-0 top-full z-50 mt-1 min-w-[200px] border border-dark-edge bg-dark-well"
        >
          {(servers ?? []).map((s) => (
            <Link
              key={s.slug}
              role="menuitem"
              href={`/maps/${s.slug}`}
              onClick={() => setOpen(false)}
              className="flex min-h-[52px] items-center justify-between gap-4 px-4 py-2 font-mono text-[15px] uppercase tracking-[.05em] text-cream-dim hover:text-paper md:min-h-[40px] md:px-3 md:text-[13px]"
            >
              {/* NO COUNT HERE, deliberately. This used to render `friendCount` — friends
                  SHARING A POSITION on that server — as a bare unlabelled number, which since
                  the online list became the ☰ button's count meant the same bar showed two
                  different counts about the same server, one of them unlabelled ("LIVONIA … 0"
                  beside "ONLINE 12"). This menu switches maps; the count belongs where it is
                  named. (The switcher now reads the public `SwitchableMap` shape, which carries
                  no count at all — the count-bearing picker page it once coexisted with is
                  gone.) */}
              {s.name}
            </Link>
          ))}
          {loading && (
            <p className="px-3 py-2 font-mono text-[11px] uppercase tracking-[.05em] text-cream-muted">
              Loading…
            </p>
          )}
        </div>
      )}
    </div>
  );
}
