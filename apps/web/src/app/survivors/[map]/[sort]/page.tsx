import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getServers, getSurvivors } from "@/lib/api";
import type { Server } from "@/lib/types";
import { SurvivorsBoard } from "@/components/survivors/survivors-board";
import { buildSurvivorMetadata } from "@/lib/survivor-metadata";
import { parsePage, buildTabs, resolveSurvivorsRoute } from "@/lib/board-params";

type Props = {
  params: Promise<{ map: string; sort: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function resolve(map: string, sort: string) {
  const servers = await getServers().catch(() => [] as Server[]);
  const slugs = servers.filter((s) => s.slug !== null).map((s) => s.slug as string);
  return { servers, route: resolveSurvivorsRoute([map, sort], slugs) };
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { map, sort } = await params;
  const { route } = await resolve(map, sort);
  if (route.kind !== "board") return { title: "Survivors" };

  const sp = await searchParams;
  const page = parsePage(sp.page);
  const data = await getSurvivors({ slug: route.slug ?? undefined, sort: route.sort, page }).catch(() => null);
  return buildSurvivorMetadata({
    slug: route.slug,
    sort: route.sort,
    page,
    total: data?.total ?? 0,
    pageSize: data?.pageSize ?? 25,
    leaderName: data?.rows[0]?.gamertag ?? null,
  });
}

export default async function SurvivorsMapSortPage({ params, searchParams }: Props) {
  const { map, sort } = await params;
  const { servers, route } = await resolve(map, sort);
  if (route.kind === "redirect") redirect(route.to);
  if (route.kind === "notFound") notFound();

  const sp = await searchParams;
  const page = parsePage(sp.page);
  const data = await getSurvivors({ slug: route.slug ?? undefined, sort: route.sort, page });

  return <SurvivorsBoard page={data} slug={route.slug} tabs={buildTabs(servers)} />;
}
