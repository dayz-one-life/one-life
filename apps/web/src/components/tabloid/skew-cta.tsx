import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const tones = {
  red: "bg-red text-paper",
  dark: "bg-dark text-paper",
  discord: "bg-discord text-paper",
} as const;

const base =
  "inline-block -skew-x-[5deg] px-5 py-2.5 font-display text-sm font-semibold uppercase tracking-[.06em] hover:opacity-90 disabled:opacity-50";

export function SkewCta({
  href, onClick, tone = "red", disabled, children,
}: {
  href?: string; onClick?: () => void; tone?: keyof typeof tones; disabled?: boolean; children: ReactNode;
}) {
  const className = cn(base, tones[tone]);
  if (href) return <Link href={href} className={className}>{children}</Link>;
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={className}>
      {children}
    </button>
  );
}
