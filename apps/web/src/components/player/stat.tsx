import { cn } from "@/lib/utils";

/** Dossier stat: big display value over a mono label (hero band lg, standing cards md). */
export function Stat({
  value,
  label,
  size = "md",
  hot = false,
  muted = false,
}: {
  value: string;
  label: string;
  size?: "md" | "lg";
  hot?: boolean;
  muted?: boolean;
}) {
  return (
    <div>
      <span
        className={cn(
          "block font-display font-bold leading-none tabular-nums",
          size === "lg" ? "text-[32px]" : "text-[21px]",
          hot ? "text-red" : muted ? "text-dash" : "text-ink",
        )}
      >
        {value}
      </span>
      <span
        className={cn(
          "block font-mono uppercase text-ink-muted",
          size === "lg" ? "mt-1 text-[11px] tracking-[.08em]" : "mt-0.5 text-[11px] tracking-[.07em]",
        )}
      >
        {label}
      </span>
    </div>
  );
}
