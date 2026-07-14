import { cn } from "@/lib/utils";
import type { InputHTMLAttributes } from "react";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn("w-full rounded-md border border-line bg-bg px-3 py-2 text-sm", className)}
      {...props}
    />
  );
}
