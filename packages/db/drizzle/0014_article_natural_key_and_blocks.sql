-- R5d PR-B plumbing. Four changes, all additive to existing rows (168 articles keep working).
--
-- 1. `natural_key` — a kind-agnostic dedupe key for article kinds that are NOT keyed by a life
--    (news items dedupe on a source-derived string). Unique only where present, so every
--    obituary/birth-notice row (NULL) is untouched by the constraint.
ALTER TABLE "articles" ADD COLUMN "natural_key" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "articles_natural_key_uniq" ON "articles" USING btree ("natural_key") WHERE "articles"."natural_key" IS NOT NULL;
--> statement-breakpoint
-- 2. The life natural-key unique index becomes PARTIAL, constraining only the two life-keyed
--    kinds. A news row carries a synthetic life tuple and must not collide with them.
--    CAUTION: a partial unique index cannot be inferred by a bare ON CONFLICT target — every
--    onConflictDoUpdate aimed at this index must pass a matching `targetWhere`, or Postgres
--    raises "no unique or exclusion constraint matching the ON CONFLICT specification" and
--    article publishing dies on the next newsdesk tick.
DROP INDEX IF EXISTS "articles_kind_server_gamertag_life_uniq";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "articles_kind_server_gamertag_life_uniq" ON "articles" USING btree ("kind","server_id","gamertag","life_started_at") WHERE "articles"."kind" IN ('obituary','birth_notice');
--> statement-breakpoint
-- 3. Feed index for kinds ordered by publication time rather than death/birth time (news).
CREATE INDEX IF NOT EXISTS "articles_kind_status_created_idx" ON "articles" USING btree ("kind","status","created_at");
--> statement-breakpoint
-- 4. Rich body as an ordered block array. NULL on every pre-R5d row; the shared ArticleBody
--    renderer falls back to splitting flat `body` on blank lines when it is NULL.
ALTER TABLE "articles" ADD COLUMN "body_blocks" jsonb;
