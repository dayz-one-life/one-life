import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes } from "react";

export function Button({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-md bg-amber px-4 py-2 text-sm font-medium text-black",
        "disabled:opacity-50 disabled:pointer-events-none hover:opacity-90", className,
      )}
      {...props}
    />
  );
}
