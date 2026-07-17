import "./globals.css";
import type { ReactNode } from "react";
import { Masthead } from "@/components/header";
import { Footer } from "@/components/footer";
import { QueryProvider } from "@/components/query-provider";
import { ControlsRail } from "@/components/controls/rail";
import { MobileControls } from "@/components/controls/mobile-controls";
import { display, mono } from "./fonts";
import { SITE_URL } from "@/lib/seo";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "One Life", template: "%s · One Life" },
  description: "All the deaths fit to print. One Life is a hardcore permadeath DayZ community — one life per server, a 24-hour ban when it ends, and an obituary that stands forever.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body className="flex min-h-screen flex-col font-sans antialiased">
        <a
          href="#content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-yellow focus:px-3 focus:py-2 focus:font-display focus:text-sm focus:font-bold focus:uppercase focus:text-ink"
        >
          Skip to content
        </a>
        <QueryProvider>
          <Masthead />
          <div
            id="content"
            className="mx-auto w-full max-w-[1440px] flex-1 xl:grid xl:grid-cols-[minmax(0,1fr)_380px] xl:px-10"
          >
            <div className="min-w-0 pb-24 xl:border-r xl:border-ink xl:pb-0 xl:pr-8">{children}</div>
            <ControlsRail />
          </div>
          <MobileControls />
          <Footer />
        </QueryProvider>
      </body>
    </html>
  );
}
