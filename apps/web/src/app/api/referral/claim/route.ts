import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { REFERRAL_COOKIE } from "@/lib/referral-cookie";
import { postReferrerClaim } from "@/lib/api";

/**
 * Consume the invite cookie: forward the slug to the API, then clear it.
 *
 * ⚠️ SAME-ORIGIN is the point. The cookie is httpOnly and scoped to the web origin, so only a
 * handler on that origin receives it — and only a Route Handler can clear it afterwards.
 *
 * ⚠️ The cookie is cleared WHATEVER happens. A cookie that survives a failed claim retries
 * forever, on every page load, for thirty days.
 */
export async function POST() {
  const jar = await cookies();
  const slug = jar.get(REFERRAL_COOKIE)?.value;
  const res = NextResponse.json({ ok: true });
  if (!slug) return res;
  try {
    await postReferrerClaim(slug);
  } catch {
    // Deliberately swallowed: a failed claim must never surface to a player who just signed in.
  }
  res.cookies.set(REFERRAL_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
