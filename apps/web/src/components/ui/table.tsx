import { cn } from "@/lib/utils";
import type { HTMLAttributes, TableHTMLAttributes } from "react";

export function Table({ className, ...p }: TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full text-left text-sm", className)} {...p} />;
}
export function Th({ className, ...p }: HTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("border-b border-line px-3 py-2 font-medium text-muted", className)} {...p} />;
}
export function Td({ className, ...p }: HTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b border-line/50 px-3 py-2", className)} {...p} />;
}
