import { readFile } from "node:fs/promises";
import { ImageResponse } from "next/og";
import { getNewsArticle } from "@/lib/api";
import { newsDateline, newsDossierFacts, triggerLabel } from "@/lib/news-format";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "One Life news feature";

// The Node OG runtime's `fetch` cannot read file: URLs, so assets are read off disk.
const asset = (name: string) => readFile(new URL(`./${name}`, import.meta.url));

export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [article, oswald, mono, monoBold] = await Promise.all([
    getNewsArticle(slug).catch(() => null),
    asset("oswald-700.ttf"),
    asset("plex-mono-400.ttf"),
    asset("plex-mono-700.ttf"),
  ]);

  const headline = article?.headline ?? "A News Feature";
  // An editorial piece has no map — its card files from the desk, same as the missing-article case.
  const line = article?.map
    ? `${triggerLabel(article.trigger)} · ${newsDateline(article.map, article.createdAt, new Date())}`
    : "ONE LIFE · THE DESK";
  // Text-only in this slice — see the Self-Review's deferral note; the photo panel is out of scope
  // here, not a parity choice. The dossier figures are read-model facts: playtime and idle time,
  // never a coordinate.
  const facts = article ? newsDossierFacts(article) : [];
  // THE UNFURL IS A DISCOVERY SURFACE. `noindex` on the interior addresses crawlers and does
  // nothing for a Discord/Slack/X unfurl — and unfurling is load-bearing here, since the obituary
  // notifier depends on it. Without this stamp the first thing a reader of a shared link sees is
  // the now-false headline, unmarked, BEFORE they click through to the correction.
  const retracted = article?.retracted === true;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0C0C08", color: "#FBFAF2", padding: 64 }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {retracted ? (
            // The card's existing vocabulary: the mono kicker face, the red the interior's
            // retraction banner already uses, boxed like the dossier's hot figures.
            <div style={{ display: "flex", alignSelf: "flex-start", border: "4px solid #FF6B63", color: "#FF6B63", fontFamily: "IBM Plex Mono", fontWeight: 700, fontSize: 30, letterSpacing: 6, textTransform: "uppercase", padding: "6px 18px", marginBottom: 18 }}>
              Retracted
            </div>
          ) : null}
          <div style={{ display: "flex", fontFamily: "IBM Plex Mono", fontSize: 22, letterSpacing: 2, color: "#8A8878", textTransform: "uppercase" }}>{line}</div>
          <div style={{ display: "flex", fontFamily: "Oswald", fontWeight: 700, fontSize: 78, lineHeight: 1.02, textTransform: "uppercase", marginTop: 20, maxWidth: 1000, opacity: retracted ? 0.55 : 1 }}>{headline}</div>
        </div>
        <div style={{ display: "flex", gap: 48 }}>
          {facts.map((f) => (
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
