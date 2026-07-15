import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getServers, getSurvivors } from "@/lib/api";
import type { Server } from "@/lib/types";
import { SurvivorsBoard } from "@/components/survivors/survivors-board";
import { buildSurvivorMetadata } from "@/lib/survivor-metadata";
import { parsePage, parseSort, buildTabs } from "@/lib/board-params";

type Props = {
  params: Promise<{ map: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Returns the active, slugged server for `map`, or null if no such live server. */
async function resolveMap(map: string): Promise<{ servers: Server[]; ok: boolean }> {
  const servers = await getServers().catch(() => [] as Server[]);
  const ok = servers.some((s) => s.slug === map);
  return { servers, ok };
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { map } = await params;
  const { ok } = await resolveMap(map);
  if (!ok) return { title: "Not found" };

  const sp = await searchParams;
  const sort = parseSort(sp.sort);
  const page = parsePage(sp.page);
  const data = await getSurvivors({ slug: map, sort, page }).catch(() => null);
  return buildSurvivorMetadata({
    slug: map,
    sort,
    page,
    total: data?.total ?? 0,
    pageSize: data?.pageSize ?? 25,
    leaderName: data?.rows[0]?.gamertag ?? null,
  });
}

export default async function SurvivorsMapPage({ params, searchParams }: Props) {
  const { map } = await params;
  const { servers, ok } = await resolveMap(map);
  if (!ok) notFound();

  const sp = await searchParams;
  const sort = parseSort(sp.sort);
  const page = parsePage(sp.page);

  const data = await getSurvivors({ slug: map, sort, page });

  return <SurvivorsBoard page={data} slug={map} tabs={buildTabs(servers)} />;
}
