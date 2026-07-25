import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getServers, getSurvivors } from "@/lib/api";
import type { Server } from "@/lib/types";
import { SurvivorsBoard } from "@/components/survivors/survivors-board";
import { buildSurvivorMetadata } from "@/lib/survivor-metadata";
import { parsePage, buildTabs, resolveSurvivorsRoute } from "@/lib/board-params";

type Props = {
  params: Promise<{ map: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function resolve(map: string) {
  const servers = await getServers().catch(() => [] as Server[]);
  const slugs = servers.filter((s) => s.slug !== null).map((s) => s.slug as string);
  return { servers, route: resolveSurvivorsRoute([map], slugs) };
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { map } = await params;
  const { route } = await resolve(map);
  if (route.kind !== "board") return { title: "Survivors" };

  const sp = await searchParams;
  const page = parsePage(sp.page);
  const data = await getSurvivors({ slug: route.slug, page }).catch(() => null);
  return buildSurvivorMetadata({
    slug: route.slug,
    page,
    total: data?.total ?? 0,
    pageSize: data?.pageSize ?? 25,
    leaderName: data?.rows[0]?.gamertag ?? null,
  });
}

/**
 * `/survivors/<slug>` is the board — one map, time alive, living players only. It is the STABLE,
 * shareable, indexable URL and never redirects; `/survivors` resolves to one of these.
 *
 * ⚠️ There is no `[sort]` segment any more, and no explicit-default redirect to preserve `?page`
 * across. Sub-project D deleted the sort layer.
 */
export default async function SurvivorsMapPage({ params, searchParams }: Props) {
  const { map } = await params;
  const { servers, route } = await resolve(map);
  if (route.kind === "notFound") notFound();

  const sp = await searchParams;
  const page = parsePage(sp.page);
  const data = await getSurvivors({ slug: route.slug, page });

  return <SurvivorsBoard page={data} slug={route.slug} tabs={buildTabs(servers)} />;
}
