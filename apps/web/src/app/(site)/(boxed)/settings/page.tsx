import type { Metadata } from "next";
import { DangerZone } from "@/components/account/danger-zone";

export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false }, // a private settings page has no business in a search index
};

export default function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-md px-6 py-12">
      <h1 className="font-display text-4xl font-bold uppercase leading-[.95] text-ink">Settings</h1>
      <DangerZone />
    </main>
  );
}
