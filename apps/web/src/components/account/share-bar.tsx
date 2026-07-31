"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { SrStatus } from "@/components/shared/sr-status";

/** The invite link + copy control. The social-target row and native-share button were removed
 *  2026-07-30 (v0.69 spec §1) — they did not work as intended. */
export function ShareBar({ link }: { link: string }) {
  const [note, setNote] = useState("");
  const copy = () => {
    void navigator.clipboard?.writeText(link).catch(() => {});
    setNote("Link copied ✓");
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          readOnly
          value={link}
          aria-label="Your invite link"
          onFocus={(e) => e.currentTarget.select()}
          className={cn("min-w-0 flex-1 border-2 px-3.5 py-3 font-mono text-[15px] tracking-[.02em] outline-none", "border-hairline bg-paper text-ink")}
        />
        <button
          type="button"
          onClick={copy}
          className="min-h-[48px] flex-none bg-ink px-6 font-display text-sm font-bold uppercase tracking-[.08em] text-paper"
        >
          Copy link
        </button>
      </div>
      {/* ⚠️ Two nodes, per the SrStatus idiom (see checkout-return.tsx): the live region is
       *  pre-mounted but sr-only, so the idle bar reserves NO visible note space. A visible
       *  always-mounted note made this control taller than the tokens half's send row, and the
       *  slab's mt-auto bottom-alignment turned the difference into stray white space above the
       *  send field next door. The visible note only mounts once there is something to say. */}
      <SrStatus>{note}</SrStatus>
      {note && (
        <span className="font-mono text-[10px] uppercase tracking-[.1em] text-ink">{note}</span>
      )}
    </div>
  );
}
