import { readFile } from "node:fs/promises";
import { ImageResponse } from "next/og";
import { getBirthNotice } from "@/lib/api";
import { priorsFacts, birthDateline } from "@/lib/birth-format";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "One Life birth notice";

const asset = (name: string) => readFile(new URL(`./${name}`, import.meta.url));

export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [article, oswald, mono, monoBold] = await Promise.all([
    getBirthNotice(slug).catch(() => null),
    asset("oswald-700.ttf"),
    asset("plex-mono-400.ttf"),
    asset("plex-mono-700.ttf"),
  ]);

  const headline = article?.headline ?? "A Birth Notice";
  const line = article ? birthDateline(article.map, article.bornAt, new Date()) : "ONE LIFE · THE NURSERY";
  const facts = article ? priorsFacts(article) : [];
  const readout = facts.length > 0 ? facts : [{ label: "Priors", value: "First life", hot: false }];

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0C0C08", color: "#FBFAF2", padding: 64 }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontFamily: "IBM Plex Mono", fontSize: 22, letterSpacing: 2, color: "#7FA8FF", textTransform: "uppercase" }}>Birth Notice · {line}</div>
          <div style={{ display: "flex", fontFamily: "Oswald", fontWeight: 700, fontSize: 78, lineHeight: 1.02, textTransform: "uppercase", marginTop: 20, maxWidth: 1000 }}>{headline}</div>
        </div>
        <div style={{ display: "flex", gap: 48 }}>
          {readout.map((f) => (
            <div key={f.label} style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontFamily: "Oswald", fontWeight: 700, fontSize: 44, color: f.hot ? "#FF6B63" : "#FBFAF2" }}>{f.value}</div>
              <div style={{ display: "flex", fontFamily: "IBM Plex Mono", fontSize: 18, letterSpacing: 1.5, color: "#8A8878", textTransform: "uppercase", marginTop: 4 }}>{f.label}</div>
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
