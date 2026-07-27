import type { Database } from "@onelife/db";
import { user } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getAvatarState, upsertAvatar, fetchProviderImage } from "./avatar-store.js";
import { processAvatarImage } from "./avatar-image.js";

/**
 * Mirrors a provider's avatar image (Discord/Google/GitHub) into our own avatar store after an
 * OAuth sign-in, the first time we see the user.
 *
 * Fire-and-forget off the login path — callers invoke `void autoPopulateAvatar(...)` from the
 * auth hook. Never throws: a login must not block or fail on avatar work. This function
 * therefore returns silently (rather than rejecting) whenever there is nothing to do or
 * anything along the way fails: no `user.image`, an avatar row that already exists in any state
 * (including a tombstone — a removal must never be resurrected by a later sign-in), a failed
 * provider fetch, or a rejected image pipeline.
 */
export async function autoPopulateAvatar(db: Database, userId: string): Promise<void> {
  try {
    const [row] = await db.select({ image: user.image }).from(user).where(eq(user.id, userId));
    if (!row?.image) return;

    // "none" only — "live" means we already mirrored one, "tombstone" means the user removed
    // it and a provider re-sync must not bring it back.
    const state = await getAvatarState(db, userId);
    if (state !== "none") return;

    const raw = await fetchProviderImage(row.image);
    const { image, hash } = await processAvatarImage(raw);
    await upsertAvatar(db, userId, { image, hash, source: "provider" });
  } catch {
    // Swallow everything — see the module doc comment.
  }
}
