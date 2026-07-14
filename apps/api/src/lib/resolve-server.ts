import type { Database } from "@onelife/db";
import { servers } from "@onelife/db";
import { eq } from "drizzle-orm";

export async function resolveServerBySlug(db: Database, slug: string) {
  const rows = await db
    .select({ id: servers.id, slug: servers.slug, name: servers.name, map: servers.map })
    .from(servers)
    .where(eq(servers.slug, slug))
    .limit(1);
  const s = rows[0];
  return s && s.slug ? { id: s.id, slug: s.slug, name: s.name, map: s.map } : null;
}
