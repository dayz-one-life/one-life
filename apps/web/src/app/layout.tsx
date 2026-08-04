import "./globals.css";
import type { ReactNode } from "react";
import { QueryProvider } from "@/components/query-provider";
import { display, mono } from "./fonts";
import { SITE_URL, SITE_DESCRIPTION, OG_DEFAULTS, organizationLd, ldScript } from "@/lib/seo";
import { SOCIAL_LINKS } from "@/components/social-links";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "One Life", template: "%s · One Life" },
  description: SITE_DESCRIPTION,
  openGraph: { ...OG_DEFAULTS, type: "website" },
  twitter: { card: "summary_large_image" },
  manifest: "/manifest.json",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body className="flex min-h-screen flex-col font-sans antialiased">
        {/* The site-wide Organization node. Here, in the ROOT layout, so it is on every surface
            including /maps and /i — not in `(site)/layout.tsx`. It sits alongside, never instead
            of, the per-page ProfilePage/NewsArticle/ItemList nodes: those describe the page, this
            describes who publishes it. `ldScript`, never raw JSON.stringify — see `lib/seo.ts`. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: ldScript(organizationLd(SOCIAL_LINKS.map((s) => s.href))) }}
        />
        {/* `focus:z-50` must stay ABOVE the z-40 chrome layer (LAYER LEGEND in
            `components/header.tsx`). This renders before any header, so at an equal z-index the
            header wins on DOM order and the chip is invisible to the keyboard users it
            exists for. On /maps the z-40 occupant is the map's top bar, not the masthead. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-yellow focus:px-3 focus:py-2 focus:font-display focus:text-sm focus:font-bold focus:uppercase focus:text-ink"
        >
          Skip to content
        </a>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
