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
  const [page, oswald, mono, monoBold, logoBuf, skullBuf] = await Promise.all([
    getPlayerPage(slug).catch(() => null),
    asset("oswald-700.ttf"), asset("space-mono-400.ttf"), asset("space-mono-700.ttf"),
    asset("logo.png"), asset("skull.png"),
  ]);
  const gamertag = page?.gamertag ?? "Unknown survivor";
  const stats = page ? heroStats(page.totals) : [];
  const since = page?.firstSeenAt ? monthYear(page.firstSeenAt) : null;
  const gtSize = gamertag.length > 12 ? 84 : gamertag.length > 9 ? 104 : 124;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "66px 74px", background: "radial-gradient(130% 110% at 80% 15%, #14170f 0%, #0a0c0a 46%, #060706 100%)", color: "#e7e3d7", fontFamily: "Oswald", position: "relative" }}>
        <div style={{ position: "absolute", top: 0, left: 0, width: "34%", height: 5, background: "#e0a13a" }} />
        <img src={dataUri(skullBuf)} width={470} height={582} style={{ position: "absolute", right: -70, top: 24, opacity: 0.07 }} />
        <img src={dataUri(logoBuf)} height={46} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: gtSize, fontWeight: 700, lineHeight: 1, letterSpacing: -1, color: "#f3efe4" }}>{gamertag}</div>
          {since && (
            <div style={{ display: "flex", fontFamily: "Space Mono", fontSize: 22, color: "#8b8578", marginTop: 26 }}>
              Surviving since&nbsp;<span style={{ fontWeight: 700, color: "#c3bdae", textTransform: "uppercase" }}>{since}</span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", borderTop: "1.5px solid rgba(231,227,215,.16)", paddingTop: 26 }}>
          {stats.map((st, i) => (
            <div key={st.label} style={{ flex: 1, display: "flex", flexDirection: "column", borderLeft: i > 0 ? "1px solid rgba(231,227,215,.1)" : "none", paddingLeft: i > 0 ? 24 : 0 }}>
              <span style={{ fontSize: 60, fontWeight: 700, lineHeight: 1, color: st.hot ? "#e0a13a" : "#efeadd" }}>{st.value}</span>
              <span style={{ fontFamily: "Space Mono", fontSize: 16, letterSpacing: 2, textTransform: "uppercase", color: "#7a7568", marginTop: 9 }}>{st.label}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Oswald", data: oswald, weight: 700, style: "normal" },
        { name: "Space Mono", data: mono, weight: 400, style: "normal" },
        { name: "Space Mono", data: monoBold, weight: 700, style: "normal" },
      ],
    },
  );
}
