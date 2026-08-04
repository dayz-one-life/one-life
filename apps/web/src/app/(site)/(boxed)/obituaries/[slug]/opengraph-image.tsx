import { ImageResponse } from "next/og";
import { getObituaryCached } from "@/lib/api";
import { rapSheetFacts, obituaryHeadlineSize } from "@/lib/obituary-format";
import { monthDayYear } from "@/components/player/format";
import { loadCardAssets, OG_SIZE, RED } from "@/lib/og/assets";
import { CardShell, type CardStat } from "@/lib/og/card-shell";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "One Life obituary";

/**
 * ⚠️ This is the single most latency-sensitive route in the app: it is what a social crawler
 * fetches, and rendering it costs an API round-trip, a font load and a PNG encode. Uncached, every
 * scrape paid all three at origin and Facebook's crawler intermittently timed out, publishing
 * posts with a blank card. `getObituaryCached` (cookie-free) plus this window lets Next cache the
 * generated PNG so repeat scrapes — and every human who sees the unfurl — are served from the edge.
 *
 * ⚠️ Do NOT add `export const dynamic = "force-dynamic"` here. That is the correct fix for an
 * `opengraph-image` with NO dynamic segment (`next build` prerenders those against an API that
 * isn't serving, baking the failure-path card in as `immutable` — see `/obituaries/opengraph-image`,
 * which still has that shape). This route has `[slug]`, so it is never prerendered, and
 * force-dynamic here would only reinstate the uncached behaviour this change exists to remove.
 *
 * Kept in sync BY HAND with `OBITUARY_REVALIDATE_SECONDS` in `@/lib/api` and the sibling `page.tsx`
 * — Next requires a statically analysable literal, so it cannot import the constant.
 */
export const revalidate = 300;

/** ⚠️ Required for the same reason as the sibling `page.tsx` — `revalidate` on its own leaves a
 *  `[slug]` route fully dynamic and `no-store`, so the generated PNG would be re-encoded on every
 *  single scrape. Empty on purpose: prerendering real slugs would fetch the API during
 *  `next build`. See `page.tsx` for the full note. */
export async function generateStaticParams(): Promise<{ slug: string }[]> {
  return [];
}

export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [a, assets] = await Promise.all([getObituaryCached(slug).catch(() => null), loadCardAssets()]);
  const headline = a?.headline ?? "An obituary from DayZ One Life";
  const stats: CardStat[] = a ? rapSheetFacts(a) : [];

  return new ImageResponse(
    (
      <CardShell
        assets={assets}
        stats={stats}
        kicker={
          <>
            <span style={{ color: RED }}>Obituary</span>
            {a && <span>&nbsp;· {a.gamertag} · {monthDayYear(a.deathAt)}</span>}
          </>
        }
      >
        <div style={{ fontSize: obituaryHeadlineSize(headline), fontWeight: 700, lineHeight: 1.04, letterSpacing: -1, textTransform: "uppercase", maxWidth: 1000 }}>
          {headline}
        </div>
      </CardShell>
    ),
    {
      ...size,
      fonts: assets.fonts,
      // ⚠️ Next serves an `opengraph-image` as `public, immutable, max-age=31536000` — a YEAR. For
      // a real obituary that is correct (the death already happened; the card can never change)
      // and is the entire point of making this route cacheable. For the FAILURE path it is a trap:
      // if the very first scrape of a slug lands while the API is unreachable, the generic
      // fallback card is what gets frozen at the CDN and in Facebook's cache for a year, and no
      // amount of re-scraping fixes it. Capping the failure path at a minute lets the next scrape
      // heal it. Measured, not assumed: with the API down this route really did return
      // `immutable, max-age=31536000` before this override.
      ...(a ? {} : { headers: { "cache-control": "public, max-age=60, must-revalidate" } }),
    },
  );
}
