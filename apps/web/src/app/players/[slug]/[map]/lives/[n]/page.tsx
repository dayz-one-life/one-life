import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPlayerLife } from "@/lib/api";
import { buildTimeline } from "@/lib/life-timeline";
import { LifeHero } from "@/components/life/hero";
import { Timeline } from "@/components/life/timeline";
import { mapLabel } from "@/components/player/format";
import { absoluteUrl } from "@/lib/seo";

type Params = { slug: string; map: string; n: string };
type Props = { params: Promise<Params> };

function parseLifeNumber(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, map, n } = await params;
  const num = parseLifeNumber(n);
  if (num === null) return { title: "Life — One Life" };
  const data = await getPlayerLife(slug, map, num).catch(() => null);
  if (!data) return { title: "Life — One Life" };
  const label = mapLabel(data.map);
  const title = `Life ${data.life.lifeNumber} · ${label} — ${data.gamertag} — One Life`;
  return {
    title,
    description: `The record of ${data.gamertag}'s life ${data.life.lifeNumber} on ${label} — every session, kill, and the death that ended it.`,
    alternates: { canonical: absoluteUrl(`/players/${slug}/${map}/lives/${num}`) },
  };
}

export default async function LifePageRoute({ params }: Props) {
  const { slug, map, n } = await params;
  const num = parseLifeNumber(n);
  if (num === null) notFound();
  const data = await getPlayerLife(slug, map, num);
  if (!data) notFound();
  const view = buildTimeline(data, new Date());
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10 md:px-10">
      <LifeHero data={data} view={view} />
      <div className="mt-6">
        <Timeline view={view} />
      </div>
    </main>
  );
}
