import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

// next/font/google runs a real font fetch at module load and cannot work under jsdom; the
// QueryProvider is a client component with its own setup. Neither is what this file is about.
vi.mock("./fonts", () => ({
  display: { variable: "font-display" },
  mono: { variable: "font-mono" },
}));
vi.mock("@/components/query-provider", () => ({
  QueryProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import RootLayout from "./layout";
import { SOCIAL_LINKS } from "@/components/social-links";

// ⚠️ renderToStaticMarkup, not RTL's `render`. This component IS the <html> element, and RTL
// mounts into a <div>, so `render` works but warns "In HTML, <html> cannot be a child of <div>"
// on every test. Serializing to a string and parsing it back is what this component's shape
// actually calls for.
const markup = () => renderToStaticMarkup(<RootLayout><div /></RootLayout>);
const ldTag = () => {
  const doc = new DOMParser().parseFromString(markup(), "text/html");
  const el = doc.querySelector('script[type="application/ld+json"]');
  expect(el).not.toBeNull();
  return el!.textContent!;
};

describe("RootLayout JSON-LD", () => {
  test("emits the site-wide Organization node", () => {
    expect(JSON.parse(ldTag())["@type"]).toBe("Organization");
  });

  // ⚠️ The wiring test, and the reason this file exists. `organizationLd` is unit-tested in
  // lib/seo.test.ts, but that proves nothing about the layout actually PASSING it the accounts —
  // and an Organization node with no sameAs is the failure this whole change exists to avoid.
  // Compared against SOCIAL_LINKS itself so adding a fifth account cannot silently skip the
  // JSON-LD while the footer row picks it up.
  test("carries every social account as sameAs", () => {
    expect(JSON.parse(ldTag()).sameAs).toEqual(SOCIAL_LINKS.map((s) => s.href));
  });

  // The escaping is checked on the RAW markup, before any parser un-escapes it: this is about
  // what is written into the tag, which is where a `</script>` break-out would happen.
  test("escapes the payload rather than writing raw JSON into the tag", () => {
    const raw = markup();
    const json = raw.slice(raw.indexOf('application/ld+json"'));
    const body = json.slice(json.indexOf(">") + 1, json.indexOf("</script>"));
    expect(body).not.toContain("<");
    expect(body).not.toContain(">");
    expect(body).toContain("@type");
  });
});
