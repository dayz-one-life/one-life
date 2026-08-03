import type { ReactNode } from "react";
import type { CardAssets } from "./assets";
import { DARK, PAPER, RED, DIM } from "./assets";

export type CardStat = { label: string; value: string; hot: boolean };

/**
 * Shared chrome for every 1200×630 OG card: red 34% top rule, faded skull, wordmark row with
 * an optional mono kicker, a middle slot, and a bottom stat band. Satori-safe: flex only,
 * inline styles, explicit `display:"flex"` on every multi-child container, no shadows.
 * When `stats` is empty/absent an empty flex div keeps `justify-between` spacing intact.
 */
export function CardShell({ assets, kicker, stats, children }: {
  assets: Pick<CardAssets, "wordmark" | "skull">;
  kicker?: ReactNode;
  stats?: CardStat[];
  children: ReactNode;
}) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "66px 74px", background: DARK, color: PAPER, fontFamily: "Oswald", position: "relative" }}>
      <div style={{ position: "absolute", top: 0, left: 0, width: "34%", height: 6, background: RED }} />
      <img src={assets.skull} width={470} height={582} style={{ position: "absolute", right: -70, top: 24, opacity: 0.07 }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <img src={assets.wordmark} height={46} />
        {kicker ? (
          <div style={{ display: "flex", fontFamily: "IBM Plex Mono", fontWeight: 700, fontSize: 22, letterSpacing: 2, textTransform: "uppercase", color: DIM }}>
            {kicker}
          </div>
        ) : null}
      </div>
      {children}
      {stats && stats.length > 0 ? (
        <div style={{ display: "flex", borderTop: "1.5px solid rgba(251,250,242,.16)", paddingTop: 26 }}>
          {stats.map((f, i) => (
            <div key={f.label} style={{ flex: 1, display: "flex", flexDirection: "column", borderLeft: i > 0 ? "1px solid rgba(251,250,242,.1)" : "none", paddingLeft: i > 0 ? 24 : 0 }}>
              <span style={{ fontSize: 60, fontWeight: 700, lineHeight: 1, color: f.hot ? RED : PAPER }}>{f.value}</span>
              <span style={{ fontFamily: "IBM Plex Mono", fontSize: 16, letterSpacing: 2, textTransform: "uppercase", color: DIM, marginTop: 9 }}>{f.label}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: "flex" }} />
      )}
    </div>
  );
}
