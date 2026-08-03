import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/legal/legal-doc";
import { PRIVACY_SECTIONS } from "@/content/legal/privacy";
import { EFFECTIVE_DATE } from "@/content/legal/effective-date";
import { absoluteUrl, OG_DEFAULTS } from "@/lib/seo";

const PRIVACY_DESCRIPTION =
  "What One Life collects about you, who else sees it, how long it is kept, and how to have it deleted. No ads, no analytics, nothing sold.";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: PRIVACY_DESCRIPTION,
  alternates: { canonical: absoluteUrl("/privacy") },
  openGraph: {
    ...OG_DEFAULTS,
    title: "Privacy Policy",
    description: PRIVACY_DESCRIPTION,
    url: absoluteUrl("/privacy"),
    type: "website",
  },
};

export default function PrivacyPage() {
  return (
    <LegalDoc
      kicker="What we know about you"
      title="Privacy Policy"
      standfirst="What One Life collects, why, who else sees it, and how to get it deleted. No ads, no analytics, nothing sold."
      effectiveDate={EFFECTIVE_DATE}
      sections={PRIVACY_SECTIONS}
    >
      <p className="mt-10 font-mono text-xs uppercase tracking-[.06em] text-ink-muted">
        See also the{" "}
        <Link href="/terms" className="underline decoration-red decoration-2 underline-offset-2">
          Terms &amp; Conditions
        </Link>
        .
      </p>
    </LegalDoc>
  );
}
