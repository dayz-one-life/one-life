"use client";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { SrStatus } from "@/components/shared/sr-status";

/** How long the copy confirmation stays on screen. It MUST expire — see the ⚠️ below. */
const NOTE_MS = 4000;

/** The invite link + copy control. The social-target row and native-share button were removed
 *  2026-07-30 (v0.69 spec §1) — they did not work as intended. */
export function ShareBar({ link }: { link: string }) {
  const [note, setNote] = useState("");
  // Bumped on every copy, including a repeat one that writes the same note text — the effect
  // below keys off this, not off `note`, so a second click restarts the timer instead of
  // inheriting the first click's nearly-expired one.
  const [copies, setCopies] = useState(0);
  const copy = () => {
    void navigator.clipboard?.writeText(link).catch(() => {});
    setNote("Link copied ✓");
    setCopies((n) => n + 1);
  };
  /* ⚠️ THE NOTE EXPIRES ON PURPOSE — this is a layout constraint, not a style choice. The
   *  visible note is an in-flow child of this gap-3 column, so while it is mounted this half
   *  is ~25px taller than the tokens half next door. ControlsSlab bottom-aligns the two halves
   *  with mt-auto inside equal-height grid cells, so that extra height is absorbed as stray
   *  white space above the SEND FIELD in the other column. A note that never cleared put that
   *  gap back permanently on first copy — i.e. it reintroduced the reported bug in the one
   *  flow every engaged player takes. Letting it expire keeps the imbalance to a brief,
   *  self-explaining moment. Do not make this note permanent without moving it out of flow. */
  useEffect(() => {
    if (!copies) return;
    const t = setTimeout(() => setNote(""), NOTE_MS);
    return () => clearTimeout(t);
  }, [copies]);
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
       *  pre-mounted so screen readers announce the mutation, but it is sr-only — and an
       *  sr-only node is position:absolute, so it is NOT a flex item and consumes neither
       *  height nor a gap. That is what makes the idle bar exactly one row tall, matching the
       *  send row next door. The visible note mounts only when there is something to say. */}
      <SrStatus>{note}</SrStatus>
      {note && (
        <span className="font-mono text-[10px] uppercase tracking-[.1em] text-ink">{note}</span>
      )}
    </div>
  );
}
