import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
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

export default async function SurvivorsMapPage({ params, searchParams }: Props) {
  const { map } = await params;
  const { servers, route } = await resolve(map);

  const sp = await searchParams;
  const page = parsePage(sp.page);

  // Preserve ?page across the explicit-default redirect (e.g. /survivors/time?page=2).
  if (route.kind === "redirect") redirect(page > 1 ? `${route.to}?page=${page}` : route.to);
  if (route.kind === "notFound") notFound();

  const data = await getSurvivors({ slug: route.slug ?? undefined, sort: route.sort, page });

  return <SurvivorsBoard page={data} slug={route.slug} tabs={buildTabs(servers)} />;
}
