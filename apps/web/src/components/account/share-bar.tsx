"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";

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
      {/* Live region so the copy confirmation is announced, not just seen. Starts empty. */}
      <span aria-live="polite" className="font-mono text-[10px] uppercase tracking-[.1em] text-ink">
        {note}
      </span>
    </div>
  );
}
