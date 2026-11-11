-- The text an obituary held before `regenerate` rewrote, retracted or restored it (death-verdict
-- plan step 9). One row per replaced version: `snapshot` is the article's prose, facts, tags,
-- cause, status and stamps as they stood; `regenerate --restore <slug>` writes the latest one
-- back. Durable: like `articles` it is never truncated by a rebuild, and it has no foreign key
-- (an article is never deleted), so the test truncation list names it.
CREATE TABLE IF NOT EXISTS "article_revisions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"article_id" bigint NOT NULL,
	"replaced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL,
	"snapshot" jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS "article_revisions_article_idx" ON "article_revisions" ("article_id", "id");
