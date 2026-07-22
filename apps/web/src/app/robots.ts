import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

/**
 * The `Sitemap:` line is how a crawler finds the sitemap without Search Console. The host comes
 * from SITE_URL, so a staging deployment advertises its own sitemap, not production's.
 *
 * AI crawlers (GPTBot, CCBot, ClaudeBot) are deliberately NOT blocked — the paper wants citations.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Private or non-content: an auth screen, a post-login resolver, a per-user inbox, and the API.
      disallow: ["/login", "/welcome", "/notifications", "/api"],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
