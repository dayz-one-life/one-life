-- Obituaries revival: recreate `articles`, dropped by 0027, trimmed to the obituary slice.
-- Deliberately absent vs the pre-0027 shape: the seven image_* columns and their index
-- (no image pipeline), discord_posted_at and its index (no Discord notifier), natural_key and
-- its unique index (news-only dedupe), the born feed index (birth notices), and the
-- subject/killer expression indexes (In The Paper is not restored).
-- DURABLE table: in APP_TABLES, never in REBUILD_TRUNCATE_TABLES. kind stays text; only
-- 'obituary' is written, but the partial unique index keeps the historical two-kind predicate
-- VERBATIM so the restored upserts' targetWhere matches it (a mismatched predicate is 42P10).
CREATE TABLE "articles" (
  "id" bigserial PRIMARY KEY,
  "kind" text NOT NULL,
  "status" text NOT NULL DEFAULT 'published',
  "slug" text,
  "server_id" integer REFERENCES "servers"("id"),
  "gamertag" text,
  "map" text,
  "map_slug" text,
  "life_number" integer,
  "life_started_at" timestamp with time zone,
  "death_at" timestamp with time zone,
  "time_alive_seconds" integer NOT NULL DEFAULT 0,
  "kills" integer NOT NULL DEFAULT 0,
  "longest_kill_meters" double precision,
  "cause" text,
  "headline" text,
  "lede" text,
  "body" text,
  "pull_quote_text" text,
  "pull_quote_attribution" text,
  "tags" text[],
  "facts" jsonb,
  "prompt_version" text,
  "model" text,
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "body_blocks" jsonb,
  "generated_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "articles_kind_server_gamertag_life_uniq"
  ON "articles" ("kind", "server_id", "gamertag", "life_started_at")
  WHERE "kind" IN ('obituary', 'birth_notice');
CREATE UNIQUE INDEX "articles_slug_uniq" ON "articles" ("slug");
CREATE INDEX "articles_kind_status_death_idx" ON "articles" ("kind", "status", "death_at");
CREATE INDEX "articles_kind_status_created_idx" ON "articles" ("kind", "status", "created_at");
