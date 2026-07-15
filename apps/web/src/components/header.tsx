"use client";
import Link from "next/link";
import { useAccountStatus } from "@/lib/use-account-status";
import { MastheadSlot } from "./masthead-slot";

export function Masthead() {
  const status = useAccountStatus();
  return (
    <header className="flex items-center gap-6 border-b border-line bg-panel-2 px-6 py-3">
      <Link href="/" aria-label="One Life — home">
        <img src="/one-life-horizontal.png" alt="One Life" className="h-9 w-auto" />
      </Link>
      <Link href="/survivors" className="text-sm text-dim hover:text-bone">
        Survivors
      </Link>
      <MastheadSlot status={status} />
    </header>
  );
}
