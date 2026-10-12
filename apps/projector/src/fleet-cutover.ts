import { and, eq } from "drizzle-orm";
import type { Database } from "@onelife/db";
import { articles, servers } from "@onelife/db";

export type RetireOp = { slug: string; newSlug: string | null };
export type AddOp = { slug: string; name: string; map: string; serviceId: number };
export type CutoverPlan = { retire: RetireOp[]; add: AddOp[]; retiredAt: Date | null; apply: boolean };
type ServerRow = typeof servers.$inferSelect;

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export function parseCutoverArgs(argv: string[]): CutoverPlan {
  const plan: CutoverPlan = { retire: [], add: [], retiredAt: null, apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--apply") plan.apply = true;
    else if (a === "--retire") {
      const [slug, newSlug] = argv[++i]!.split("=");
      plan.retire.push({ slug: slug!, newSlug: newSlug ?? null });
    } else if (a === "--add") {
      const [slug, name, map, svc] = argv[++i]!.split(":");
      if (!slug || !name || !map || !svc || !Number.isFinite(Number(svc))) throw new Error(`fleet-cutover: bad --add ${argv[i]}`);
      plan.add.push({ slug, name, map, serviceId: Number(svc) });
    } else if (a === "--retired-at") {
      const raw = argv[++i]!;
      // ⚠️ Require an explicit offset: a bare local time would be read in the host's zone and silently shift retired_at.
      const d = ISO_WITH_OFFSET.test(raw) ? new Date(raw) : new Date(NaN);
      if (Number.isNaN(d.getTime())) throw new Error(`fleet-cutover: bad --retired-at ${argv[i]}`);
      plan.retiredAt = d;
    } else if (a !== "--") throw new Error(`fleet-cutover: unknown argument ${a}`);
  }
  return plan;
}

class DryRun extends Error {}

/** ⚠️ One transaction, ordered: retirements, then slug renames, then inserts. The retiring row must
 *  release its slug before the new row can take it. Any refusal rolls back everything.
 *  ⚠️ A rename also re-points that server's obituaries: `articles.map_slug` is a copy taken at
 *  publish time, so left alone it would hand an old obituary's "Final Reload" and life link to
 *  the NEW server that takes the slug over. */
export async function runCutover(db: Database, plan: CutoverPlan, at: Date) {
  const retiredAt = plan.retiredAt ?? at;
  let result!: { before: ServerRow[]; after: ServerRow[]; repointedArticles: number };
  try {
    await db.transaction(async (tx) => {
      const before = await tx.select().from(servers).orderBy(servers.id);
      const retiredIds = new Map<RetireOp, number>();
      for (const r of plan.retire) {
        const [row] = await tx.select().from(servers).where(eq(servers.slug, r.slug));
        if (!row) throw new Error(`fleet-cutover: no server with slug ${r.slug}`);
        if (row.retiredAt) throw new Error(`fleet-cutover: ${r.slug} is already retired`);
        await tx.update(servers).set({ active: false, retiredAt }).where(eq(servers.id, row.id));
        retiredIds.set(r, row.id);
      }
      let repointedArticles = 0;
      for (const r of plan.retire) {
        if (!r.newSlug) continue;
        const [taken] = await tx.select().from(servers).where(eq(servers.slug, r.newSlug));
        if (taken) throw new Error(`fleet-cutover: slug ${r.newSlug} is taken`);
        const id = retiredIds.get(r)!;
        await tx.update(servers).set({ slug: r.newSlug }).where(eq(servers.id, id));
        const moved = await tx.update(articles).set({ mapSlug: r.newSlug }).where(eq(articles.serverId, id)).returning({ id: articles.id });
        repointedArticles += moved.length;
      }
      for (const a of plan.add) {
        const [taken] = await tx.select().from(servers).where(eq(servers.slug, a.slug));
        if (taken) throw new Error(`fleet-cutover: slug ${a.slug} is taken`);
        const [live] = await tx.select().from(servers).where(and(eq(servers.nitradoServiceId, a.serviceId), eq(servers.active, true)));
        if (live) throw new Error(`fleet-cutover: service ${a.serviceId} already has an active row (${live.slug})`);
        await tx.insert(servers).values({ nitradoServiceId: a.serviceId, name: a.name, map: a.map, slug: a.slug, active: true, ingestFrom: at });
      }
      const after = await tx.select().from(servers).orderBy(servers.id);
      result = { before, after, repointedArticles };
      if (!plan.apply) throw new DryRun();
    });
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { getDb } = await import("@onelife/db");
  if (!process.env.DATABASE_URL) throw new Error("fleet-cutover: DATABASE_URL is required");
  const { db, sql: end } = getDb(process.env.DATABASE_URL);
  const plan = parseCutoverArgs(process.argv.slice(2));
  const { before, after, repointedArticles } = await runCutover(db, plan, new Date());
  const show = (rs: ServerRow[]) => console.table(rs.map((s) => ({ id: s.id, slug: s.slug, name: s.name, map: s.map, service: s.nitradoServiceId, active: s.active, retired_at: s.retiredAt?.toISOString() ?? null, ingest_from: s.ingestFrom?.toISOString() ?? null })));
  console.log("BEFORE"); show(before);
  console.log(plan.apply ? "AFTER (applied)" : "AFTER (dry run, nothing changed; pass --apply)"); show(after);
  console.log(`obituaries re-pointed to a renamed slug: ${repointedArticles}${plan.apply ? "" : " (dry run, nothing changed)"}`);
  await end.end();
  process.exit(0);
}
