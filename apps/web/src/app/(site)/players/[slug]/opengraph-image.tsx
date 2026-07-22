import { readFile } from "node:fs/promises";
import { ImageResponse } from "next/og";
import { getPlayerPage } from "@/lib/api";
import { heroStats, monthYear } from "@/components/player/format";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "One Life survivor profile";

const asset = (name: string) => readFile(new URL(`./${name}`, import.meta.url));
const dataUri = (buf: Buffer) => `data:image/png;base64,${buf.toString("base64")}`;

export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [page, oswald, mono, monoBold, wordmarkBuf, skullBuf] = await Promise.all([
    getPlayerPage(slug).catch(() => null),
    asset("oswald-700.ttf"), asset("plex-mono-400.ttf"), asset("plex-mono-700.ttf"),
    asset("wordmark.png"), asset("skull.png"),
  ]);
  const gamertag = page?.gamertag ?? "Unknown survivor";
  const stats = page ? heroStats(page.totals) : [];
  const since = page?.firstSeenAt ? monthYear(page.firstSeenAt) : null;
  const gtSize = gamertag.length > 12 ? 84 : gamertag.length > 9 ? 104 : 124;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "66px 74px", background: "#0C0C08", color: "#FBFAF2", fontFamily: "Oswald", position: "relative" }}>
        <div style={{ position: "absolute", top: 0, left: 0, width: "34%", height: 6, background: "#FF1E12" }} />
        <img src={dataUri(skullBuf)} width={470} height={582} style={{ position: "absolute", right: -70, top: 24, opacity: 0.07 }} />
        <img src={dataUri(wordmarkBuf)} height={46} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: gtSize, fontWeight: 700, lineHeight: 1, letterSpacing: -1, color: "#FBFAF2" }}>{gamertag}</div>
          {since && (
            <div style={{ display: "flex", fontFamily: "IBM Plex Mono", fontSize: 22, color: "#8A8878", marginTop: 26 }}>
              First seen&nbsp;<span style={{ fontWeight: 700, color: "#FBFAF2", textTransform: "uppercase" }}>{since}</span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", borderTop: "1.5px solid rgba(251,250,242,.16)", paddingTop: 26 }}>
          {stats.map((st, i) => (
            <div key={st.label} style={{ flex: 1, display: "flex", flexDirection: "column", borderLeft: i > 0 ? "1px solid rgba(251,250,242,.1)" : "none", paddingLeft: i > 0 ? 24 : 0 }}>
              <span style={{ fontSize: 60, fontWeight: 700, lineHeight: 1, color: st.hot ? "#FF1E12" : "#FBFAF2" }}>{st.value}</span>
              <span style={{ fontFamily: "IBM Plex Mono", fontSize: 16, letterSpacing: 2, textTransform: "uppercase", color: "#8A8878", marginTop: 9 }}>{st.label}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Oswald", data: oswald, weight: 700, style: "normal" },
        { name: "IBM Plex Mono", data: mono, weight: 400, style: "normal" },
        { name: "IBM Plex Mono", data: monoBold, weight: 700, style: "normal" },
      ],
    },
  );
}
