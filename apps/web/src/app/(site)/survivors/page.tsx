import type { Metadata } from "next";
import { getServers, getSurvivors } from "@/lib/api";
import type { Server } from "@/lib/types";
import { SurvivorsBoard } from "@/components/survivors/survivors-board";
import { buildSurvivorMetadata } from "@/lib/survivor-metadata";
import { parsePage, buildTabs, DEFAULT_SORT } from "@/lib/board-params";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const data = await getSurvivors({ sort: DEFAULT_SORT, page }).catch(() => null);
  return buildSurvivorMetadata({
    slug: null,
    sort: DEFAULT_SORT,
    page,
    total: data?.total ?? 0,
    pageSize: data?.pageSize ?? 25,
    leaderName: data?.rows[0]?.gamertag ?? null,
  });
}

export default async function SurvivorsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const page = parsePage(sp.page);

  const [servers, data] = await Promise.all([
    getServers().catch(() => [] as Server[]),
    getSurvivors({ sort: DEFAULT_SORT, page }),
  ]);

  return <SurvivorsBoard page={data} slug={null} tabs={buildTabs(servers)} />;
}
