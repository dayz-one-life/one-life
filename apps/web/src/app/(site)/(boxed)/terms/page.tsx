import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc } from "@/components/legal/legal-doc";
import { TERMS_SECTIONS } from "@/content/legal/terms";
import { EFFECTIVE_DATE } from "@/content/legal/effective-date";
import { absoluteUrl, OG_DEFAULTS } from "@/lib/seo";

const TERMS_DESCRIPTION =
  "The rules for the One Life website and the One Life servers — accounts, gamertags, unban tokens, the record, and what gets you banned.";

export const metadata: Metadata = {
  title: "Terms & Conditions",
  description: TERMS_DESCRIPTION,
  alternates: { canonical: absoluteUrl("/terms") },
  openGraph: {
    ...OG_DEFAULTS,
    title: "Terms & Conditions",
    description: TERMS_DESCRIPTION,
    url: absoluteUrl("/terms"),
    type: "website",
  },
};

export default function TermsPage() {
  return (
    <LegalDoc
      kicker="The fine print"
      title="Terms & Conditions"
      standfirst="These cover the One Life website and the One Life servers. Using either means you accept them."
      effectiveDate={EFFECTIVE_DATE}
      sections={TERMS_SECTIONS}
    >
      <p className="mt-10 font-mono text-xs uppercase tracking-[.06em] text-ink-muted">
        See also the{" "}
        <Link href="/privacy" className="underline decoration-red decoration-2 underline-offset-2">
          Privacy Policy
        </Link>
        .
      </p>
    </LegalDoc>
  );
}
