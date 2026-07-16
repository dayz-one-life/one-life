import type { ReactNode } from "react";

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between border-b-[3px] border-ink pb-2">
      <h2 className="font-display text-2xl font-bold uppercase leading-none">{title}</h2>
      {action}
    </div>
  );
}
