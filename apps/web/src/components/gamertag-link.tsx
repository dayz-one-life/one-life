import Link from "next/link";
import { playerSlug } from "@/lib/slug";

export function GamertagLink({ gamertag, className }: { gamertag: string; className?: string }) {
  return (
    <Link href={`/players/${playerSlug(gamertag)}`} className={`font-hand text-bone hover:text-amber ${className ?? ""}`}>
      {gamertag}
    </Link>
  );
}
