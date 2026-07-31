import { NextResponse } from "next/server";
import { REFERRAL_COOKIE, REFERRAL_COOKIE_MAX_AGE, isStorableSlug } from "@/lib/referral-cookie";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The invite link — an HTML interstitial, not a redirect (v0.69 spec §3).
 *
 * ⚠️ 200 + OG tags + client bounce, for EVERY caller. Unfurlers need HTML and never follow a
 * redirect to render a preview; humans bounce via script (or meta refresh without JS). No UA
 * sniffing — one shape for everyone.
 *
 * ⚠️ Still a Route Handler: only Route Handlers and server actions may set cookies. It creates
 * NO `referrals` row — the claim is made after sign-in by `app/api/referral/claim/route.ts`.
 */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const storable = isStorableSlug(slug);
  const origin = new URL(req.url).origin;
  const name = storable ? esc(slug.toUpperCase()) : null;
  const title = name ? `${name} dares you to survive DayZ One Life` : "Someone dares you to survive DayZ One Life";
  const desc = "One life. One death. One 24-hour ban. Earn your way back or stay in the dirt.";
  const self = `${origin}/i/${encodeURIComponent(slug)}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<meta name="robots" content="noindex">
<meta property="og:site_name" content="DayZ One Life">
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${self}">
<meta property="og:image" content="${self}/card">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${self}/card">
</head><body>
<script>location.replace("/")</script>
<noscript><meta http-equiv="refresh" content="0;url=/"><a href="/">Continue to DayZ One Life</a></noscript>
</body></html>`;
  const res = new NextResponse(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  if (storable) {
    res.cookies.set(REFERRAL_COOKIE, slug, {
      httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: REFERRAL_COOKIE_MAX_AGE,
    });
  }
  return res;
}
