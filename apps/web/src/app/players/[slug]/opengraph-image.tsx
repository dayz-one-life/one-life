import { ImageResponse } from "next/og";
import { getPlayerPage } from "@/lib/api";
import { formatDuration } from "@/components/player/format";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "One Life survivor profile";

export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await getPlayerPage(slug).catch(() => null);
  const gamertag = page?.gamertag ?? "Unknown survivor";
  const stats = page
    ? [
        [String(page.totals.kills), "Kills"],
        [String(page.totals.lives), "Lives"],
        [formatDuration(page.totals.longestLifeSeconds), "Longest life"],
      ]
    : [];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", background: "#0d1017", color: "#fff", padding: 80, fontFamily: "sans-serif" }}>
        <div style={{ fontSize: 64, fontWeight: 800 }}>{gamertag}</div>
        {page?.verified && <div style={{ fontSize: 24, color: "#7fdca0", marginTop: 8 }}>✓ Verified survivor</div>}
        <div style={{ display: "flex", gap: 20, marginTop: 40 }}>
          {stats.map(([v, l]) => (
            <div key={l} style={{ display: "flex", flexDirection: "column", background: "rgba(120,180,255,0.12)", borderRadius: 12, padding: "16px 28px" }}>
              <span style={{ fontSize: 44, fontWeight: 800 }}>{v}</span>
              <span style={{ fontSize: 18, opacity: 0.7 }}>{l}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 40, fontSize: 20, letterSpacing: 2, opacity: 0.5 }}>ONE LIFE · DAYZ</div>
      </div>
    ),
    size,
  );
}
