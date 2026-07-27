import type { Database } from "@onelife/db";
import { avatars } from "@onelife/db";
import { and, eq, isNotNull } from "drizzle-orm";
import { AVATAR_MAX_BYTES } from "./avatar-image.js";

const AVATAR_FETCH_TIMEOUT_MS = 5000;
const AVATAR_FETCH_MAX_REDIRECTS = 3;

// The three configured login providers' avatar CDNs — the only hosts a production fetch may
// ever reach. `user.image` is user-writable (Better Auth's default update-user endpoint accepts
// it), so it is attacker input, not a trusted provider URL, and every hop of a redirect chain is
// re-checked against this list — a compliant host redirecting to an internal target must still
// be rejected.
const PROVIDER_HOSTS = new Set(["cdn.discordapp.com", "avatars.githubusercontent.com"]);
const PROVIDER_HOST_SUFFIXES = [".googleusercontent.com"];

function isAllowedProviderHost(hostname: string): boolean {
  return PROVIDER_HOSTS.has(hostname) || PROVIDER_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

/** Insert-or-replace the durable avatar row for one user. */
export async function upsertAvatar(
  db: Database,
  userId: string,
  data: { image: Buffer; hash: string; source: "provider" | "upload" },
): Promise<void> {
  const now = new Date();
  await db
    .insert(avatars)
    .values({ userId, image: data.image, hash: data.hash, source: data.source, updatedAt: now })
    .onConflictDoUpdate({
      target: avatars.userId,
      set: { image: data.image, hash: data.hash, source: data.source, updatedAt: now },
    });
}

/** Removal tombstone — same row, nulled fields. Never a DELETE: a tombstone is what makes
 *  "no avatar" distinguishable from "never had one" and lets a later sync resurrect the row. */
export async function tombstoneAvatar(db: Database, userId: string): Promise<void> {
  const now = new Date();
  await db
    .insert(avatars)
    .values({ userId, image: null, hash: null, source: null, updatedAt: now })
    .onConflictDoUpdate({
      target: avatars.userId,
      set: { image: null, hash: null, source: null, updatedAt: now },
    });
}

/** Public hash-addressed lookup — never returns a tombstoned row's (null) image. */
export async function getAvatarByHash(db: Database, hash: string): Promise<Buffer | null> {
  const [row] = await db
    .select({ image: avatars.image })
    .from(avatars)
    .where(and(eq(avatars.hash, hash), isNotNull(avatars.image)));
  return row?.image ?? null;
}

export async function getAvatarState(db: Database, userId: string): Promise<"none" | "live" | "tombstone"> {
  const [row] = await db.select({ image: avatars.image }).from(avatars).where(eq(avatars.userId, userId));
  if (!row) return "none";
  return row.image ? "live" : "tombstone";
}

/** The current hash for `GET /me/avatar`, or null on no row / a tombstone. */
export async function getAvatarHash(db: Database, userId: string): Promise<string | null> {
  const [row] = await db.select({ hash: avatars.hash }).from(avatars).where(eq(avatars.userId, userId));
  return row?.hash ?? null;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

/**
 * Fetches a provider's avatar image, restricted in production to the HTTPS provider-CDN
 * allowlist above, following at most AVATAR_FETCH_MAX_REDIRECTS redirects, with a 5s overall
 * timeout and a streamed 5MB cap (the connection is aborted the moment the cap is exceeded,
 * rather than buffering an oversized body to memory first). Every hop — the initial URL and
 * every redirect target — is re-validated against the allowlist, so a compliant host redirecting
 * to an internal address is rejected rather than followed.
 *
 * `opts.allowTestHosts` is a TEST-ONLY escape hatch (never set outside tests — production code
 * paths default it to false) that additionally permits plain http on loopback, so tests can
 * stand up a local stub server without TLS.
 */
export async function fetchProviderImage(
  url: string,
  opts?: { allowTestHosts?: boolean },
): Promise<Buffer> {
  const allowTestHosts = opts?.allowTestHosts ?? false;
  let current = url;
  let redirectsFollowed = 0;

  for (;;) {
    const parsed = new URL(current);
    const isTestLoopback = allowTestHosts && parsed.protocol === "http:" && isLoopbackHost(parsed.hostname);
    if (!isTestLoopback) {
      if (parsed.protocol !== "https:") throw new Error("insecure_url");
      if (!isAllowedProviderHost(parsed.hostname)) throw new Error("host_not_allowed");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AVATAR_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current, { redirect: "manual", signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error("redirect_without_location");
      if (redirectsFollowed >= AVATAR_FETCH_MAX_REDIRECTS) throw new Error("too_many_redirects");
      redirectsFollowed += 1;
      current = new URL(location, current).toString();
      continue;
    }

    if (!res.ok) throw new Error(`fetch_failed_status_${res.status}`);
    if (!res.body) return Buffer.alloc(0);

    const reader = res.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > AVATAR_MAX_BYTES) {
        await reader.cancel();
        throw new Error("too_large");
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }
}
