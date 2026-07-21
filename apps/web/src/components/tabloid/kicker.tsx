import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const colors = { red: "text-red-deep", blue: "text-blue", yellow: "text-yellow", ink: "text-ink" } as const;

export function Kicker({ children, color = "red" }: { children: ReactNode; color?: keyof typeof colors }) {
  return (
    <p className={cn("font-display text-sm font-bold uppercase tracking-[.14em]", colors[color])}>
      {children}
    </p>
  );
}
