import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPlayerLife } from "@/lib/api";
import { buildTimeline } from "@/lib/life-timeline";
import { viewerHasBlocked } from "@/lib/viewer-blocks";
import { LifeHero } from "@/components/life/hero";
import { Timeline } from "@/components/life/timeline";
import { LocationPanel } from "@/components/life/location-panel";
import { mapLabel } from "@/components/player/format";
import { absoluteUrl, OG_DEFAULTS } from "@/lib/seo";

type Params = { slug: string; map: string; n: string };
type Props = { params: Promise<Params> };

function parseLifeNumber(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, map, n } = await params;
  const num = parseLifeNumber(n);
  if (num === null) return { title: { absolute: "Life — One Life" } };
  const data = await getPlayerLife(slug, map, num).catch(() => null);
  if (!data) return { title: { absolute: "Life — One Life" } };
  const label = mapLabel(data.map);
  const title = `Life ${data.life.lifeNumber} · ${label} — ${data.gamertag} — One Life`;
  const description = `The record of ${data.gamertag}'s life ${data.life.lifeNumber} on ${label} — every session, kill, and the death that ended it.`;
  const canonical = absoluteUrl(`/players/${slug}/${map}/lives/${num}`);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical },
    openGraph: { ...OG_DEFAULTS, title, description, url: canonical, type: "profile" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function LifePageRoute({ params }: Props) {
  const { slug, map, n } = await params;
  const num = parseLifeNumber(n);
  if (num === null) notFound();
  const data = await getPlayerLife(slug, map, num);
  if (!data) notFound();
  const view = buildTimeline(data, new Date());
  // ⚠️ The block is applied HERE, not in the read-model. `getLifeTimeline` returns the avatar
  // hash viewer-independently on purpose — the same payload is served through the cookie-free,
  // shared `getPlayerLifeCached` (obituary page), so a viewer's block list must never enter it.
  // This page renders per request with the caller's cookies, so the viewer is known here and
  // only here. The colocated `opengraph-image` is shared output and deliberately does NOT do
  // this (it renders no avatar at all).
  const avatarBlocked = await viewerHasBlocked(data.gamertag);
  return (
    <main className="w-full pb-10">
      <LifeHero data={data} view={view} avatarBlocked={avatarBlocked} />
      <div className="mt-6 px-6 md:px-10">
        <Timeline
          view={view}
          locationSlot={
            <LocationPanel
              mapSlug={map}
              lifeNumber={num}
              pageGamertag={data.gamertag}
              alive={data.life.endedAt === null}
            />
          }
        />
      </div>
    </main>
  );
}
