"use client";
import Link from "next/link";
import { useSession } from "@/lib/auth-client";

export default function Home() {
  const { data: session, isPending } = useSession();
  return (
    <main className="mx-auto flex max-w-2xl flex-col items-center gap-8 px-6 py-24 text-center">
      <img src="/one-life-horizontal.png" alt="One Life" className="h-16 w-auto" />
      <p className="font-sans text-lg leading-relaxed text-dim">
        One life. From spawn to death, tracked across every session. Verify your gamertag with
        a sequence of emotes, earn your way back after a qualified death, and hold the line.
      </p>
      {!isPending && (
        <Link
          href={session ? "/account" : "/login"}
          className="rounded border border-line px-6 py-2.5 font-sans text-sm font-extrabold uppercase tracking-wide text-amber hover:text-bone"
        >
          {session ? "My account" : "Sign in"}
        </Link>
      )}
    </main>
  );
}
