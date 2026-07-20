import Link from "next/link";
import { cn } from "@/lib/utils";
import { AvatarDisc } from "./identity-row";
import type { PillLine, ServerCardData } from "./format";

/** Floating mobile sign-in box for signed-out visitors — the mobile counterpart of the rail's
 *  sign-in CTA, so a logged-out reader never has to scroll to the footer to sign in. */
export function SignInPill() {
  return (
    <Link
      href="/login"
      aria-label="Sign in"
      className="fixed inset-x-3.5 bottom-[calc(14px+env(safe-area-inset-bottom))] z-40 flex min-h-[44px] items-center justify-between gap-3 border-2 border-red bg-dark px-4 py-2.5 shadow-[0_10px_30px_rgba(0,0,0,.35)] xl:hidden"
    >
      <span className="font-display text-sm font-bold uppercase tracking-[.08em] leading-tight text-paper">
        Get in the paper.
      </span>
      <span className="flex-none font-mono text-[11px] font-bold uppercase tracking-[.06em] text-red-soft">
        Sign in →
      </span>
    </Link>
  );
}

const TONE: Record<PillLine["tone"], string> = {
  red: "text-red-soft",
  yellow: "text-yellow",
  dim: "text-cream-dim",
  muted: "text-cream-muted",
};

/** Floating mobile pill (canvas 10b). One big button; the sheet is its dialog. */
export function ControlsPillView({
  name,
  line,
  dots,
  balance,
  verified,
  open,
  onOpen,
}: {
  name: string;
  line: PillLine;
  dots: ServerCardData["state"][];
  balance: number | null;
  verified: boolean;
  open: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-controls="controls-sheet"
      className="fixed inset-x-3.5 bottom-[calc(14px+env(safe-area-inset-bottom))] z-40 flex min-h-[44px] items-center gap-3 border-2 border-red bg-dark px-4 py-2.5 text-left shadow-[0_10px_30px_rgba(0,0,0,.35)] xl:hidden"
    >
      <AvatarDisc name={name} size={30} />
      <span className="min-w-0 flex-1">
        <span className="block font-display text-sm font-bold uppercase tracking-[.08em] leading-tight text-paper">
          Player controls
        </span>
        <span className={cn("block truncate font-mono text-[10px] uppercase tracking-[.04em]", TONE[line.tone])}>
          {line.text}
        </span>
      </span>
      {verified && (
        <>
          <span aria-hidden className="flex flex-none items-center gap-1.5">
            {dots.map((s, i) => (
              <span
                key={i}
                className={cn(
                  "h-[9px] w-[9px] rounded-full",
                  s === "alive" && "bg-blue",
                  s === "banned" && "bg-red",
                  s === "idle" && "border border-dashed border-cream-muted",
                )}
              />
            ))}
          </span>
          <span className="flex-none border-l border-dark-line pl-3 font-display text-[15px] font-bold leading-none tabular-nums text-paper">
            {balance ?? 0} <span className="text-[10px] tracking-[.06em] text-cream-muted">tok</span>
          </span>
        </>
      )}
    </button>
  );
}
