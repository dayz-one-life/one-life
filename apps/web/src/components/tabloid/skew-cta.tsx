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

type Common = { tone?: keyof typeof tones; children: ReactNode };
type AsLink = Common & { href: string; onClick?: never; disabled?: never };
type AsButton = Common & { onClick: () => void; href?: never; disabled?: boolean };

export function SkewCta(props: AsLink | AsButton) {
  const className = cn(base, tones[props.tone ?? "red"]);
  if ("href" in props && props.href !== undefined) {
    return <Link href={props.href} className={className}>{props.children}</Link>;
  }
  return (
    <button type="button" onClick={props.onClick} disabled={props.disabled} className={className}>
      {props.children}
    </button>
  );
}
