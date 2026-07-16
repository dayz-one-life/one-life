import Link from "next/link";
import { cn } from "@/lib/utils";
import { playerSlug } from "@/lib/slug";

/**
 * Site-wide link to a player's dossier. Typography comes from the caller —
 * the default carries only the hover accent.
 */
export function GamertagLink({ gamertag, className }: { gamertag: string; className?: string }) {
  return (
    <Link href={`/players/${playerSlug(gamertag)}`} className={cn("hover:text-red", className)}>
      {gamertag}
    </Link>
  );
}
