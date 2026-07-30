import { NextResponse } from "next/server";
import { REFERRAL_COOKIE, REFERRAL_COOKIE_MAX_AGE, isStorableSlug } from "@/lib/referral-cookie";

/**
 * The invite link. Sets a cookie naming the referrer and bounces to the home page.
 *
 * ⚠️ A Route Handler, not a page: only Route Handlers and server actions may set cookies.
 *
 * ⚠️ It creates NO `referrals` row — the visitor has no account yet. The claim is made after
 * sign-in by `app/api/referral/claim/route.ts`.
 *
 * ⚠️ 307, never 308: where an invite lands depends on whether the visitor has a session, and a
 * permanent redirect on a session-dependent decision gets cached against them.
 */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const res = NextResponse.redirect(new URL("/", req.url), 307);
  if (isStorableSlug(slug)) {
    res.cookies.set(REFERRAL_COOKIE, slug, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: REFERRAL_COOKIE_MAX_AGE,
    });
  }
  return res;
}
