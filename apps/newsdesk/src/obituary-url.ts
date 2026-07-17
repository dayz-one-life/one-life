/** Absolute URL of an obituary's interior page. Mirrors apps/web seo.ts SITE_URL trailing-slash
 *  handling (single trailing slash stripped) and obituaryHref (`/obituaries/${slug}`). */
export function obituaryUrl(siteUrl: string, slug: string): string {
  return `${siteUrl.replace(/\/$/, "")}/obituaries/${slug}`;
}
