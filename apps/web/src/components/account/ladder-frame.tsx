import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ladderSteps, type LadderStep } from "@/components/account/ladder";

function StepMark({ state }: { state: LadderStep["state"] }) {
  if (state === "done") {
    return (
      <span aria-hidden className="flex-none font-display text-[13px] font-bold text-red-deep">
        ✓
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "mt-[3px] block size-2.5 flex-none rounded-full border-2",
        state === "current" ? "border-red bg-red" : "border-dash",
      )}
    />
  );
}

/**
 * The onboarding frame: signed in → claim → prove, with the current step expanded and the others
 * collapsed to a single line. The panels themselves (`LinkTagPanel`, `ProveItPanel`) are
 * unchanged; this only arranges them.
 *
 * `children` is the current step's panel, rendered under whichever step is current. A step that
 * is not current renders its label alone — never a disabled copy of the panel, which would put
 * inert form controls in the tab order.
 */
export function LadderFrame({
  kind,
  children,
}: {
  kind: "unlinked" | "pending";
  children: ReactNode;
}) {
  const steps = ladderSteps(kind);
  return (
    <ol aria-label="Getting set up" className="flex flex-col gap-3">
      {steps.map((step) => (
        <li key={step.label} className="flex flex-col gap-3">
          <div className="flex items-start gap-2.5">
            <StepMark state={step.state} />
            <span
              className={cn(
                "font-mono text-[11px] uppercase tracking-[.06em]",
                step.state === "current" ? "font-bold text-ink" : "text-ink-muted",
              )}
            >
              {step.label}
              {/* The state is carried in the text, not only in the mark: the pips are aria-hidden
               *  decoration, so without this a screen reader hears three identical labels. */}
              <span className="sr-only">
                {step.state === "done" ? " — done" : step.state === "current" ? " — current step" : " — not yet"}
              </span>
            </span>
          </div>
          {step.state === "current" && children}
        </li>
      ))}
    </ol>
  );
}
