import { notifications } from "@onelife/db";

/**
 * Structurally identical to apps/notifier/src/types.ts NotificationDraft. Duplicated
 * deliberately: a package must not depend on an app. Same precedent as playerSlug, which
 * the notifier duplicates out of apps/web for exactly this reason. Both copies must stay
 * in step with the notifications table's column set.
 */
export type NotificationDraft = {
  userId: string;
  kind: string;
  naturalKey: string;
  title: string;
  body: string;
  href: string;
};

/** Mirror of apps/web/src/lib/slug.ts playerSlug. Out of step ⇒ notification links 404. */
export function playerSlug(gamertag: string): string {
  return gamertag.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Accepts a drizzle db OR transaction executor — both expose the same query builder, but
// Database and PgTransaction are distinct TS types. Same loose-typing precedent as
// packages/tokens/src/internal.ts's Executor.
type Executor = { insert: (table: any) => any };

/**
 * Insert one notification.
 *
 * onConflictDoNothing targets a PLAIN unique index, so it takes NO targetWhere — do not
 * copy the targetWhere argument from apps/newsdesk/src/pg-store.ts, whose index is partial.
 * request_seq already makes a collision impossible; this is belt and braces, so a
 * duplicate key can never turn a friend request into a 500.
 */
export async function writeNotification(tx: Executor, draft: NotificationDraft): Promise<void> {
  await tx.insert(notifications).values(draft).onConflictDoNothing({ target: notifications.naturalKey });
}

/**
 * Kind 13 (sub-project E): someone handed you their position for this session.
 *
 * naturalKey is `location_shared:<granteeUserId>:<granterGamertag>:<granterSessionConnectedAt ISO>`
 * — one per granter, per grantee, per GAME SESSION.
 *
 * ⚠️ The trailing component is the SAME session snapshot the visibility predicate uses. That is
 * what makes re-granting inside one session idempotent (onConflictDoNothing swallows it) while a
 * grant in a LATER session correctly notifies again. A key without it would tell the recipient
 * once and then never again, however many sessions later; a key using `now` would spam them on
 * every click.
 *
 * ⚠️ Not `sessions.id`: ids are reassigned by a projection rebuild (rebuild.ts truncates the
 * table WITH RESTART IDENTITY), so an id-keyed notification could collide with a stale row and
 * silently notify nobody. The timestamp is folded from the ADM line and survives a rebuild.
 */
export function locationSharedNotification(a: {
  granteeUserId: string;
  granterGamertag: string;
  sessionConnectedAt: Date;
  mapSlug: string;
  mapName: string;
}): NotificationDraft {
  return {
    userId: a.granteeUserId,
    kind: "location_shared",
    naturalKey: `location_shared:${a.granteeUserId}:${a.granterGamertag}:${a.sessionConnectedAt.toISOString()}`,
    title: `${a.granterGamertag} shared their position`,
    // States the scope, because the scope is the point: it is not a standing permission.
    body: `You can see them on ${a.mapName} until they log out.`,
    href: `/maps/${a.mapSlug}`,
  };
}
