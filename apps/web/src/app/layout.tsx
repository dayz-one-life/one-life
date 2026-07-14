import "./globals.css";
import type { ReactNode } from "react";
import { Masthead } from "@/components/header";
import { Footer } from "@/components/footer";
import { display, hand } from "./fonts";
import { SITE_URL } from "@/lib/seo";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "One Life", template: "%s · One Life" },
  description: "A chronicle of the living and the dead on the One Life DayZ servers.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`dark ${display.variable} ${hand.variable}`}>
      <body className="flex min-h-screen flex-col font-sans antialiased">
        <Masthead />
        <div className="flex-1">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
