CREATE TABLE "avatars" (
  "user_id" text PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  "image" bytea,
  "hash" text,
  "source" text,
  "updated_at" timestamptz NOT NULL
);
CREATE INDEX "avatars_hash_idx" ON "avatars" ("hash") WHERE hash IS NOT NULL;

DROP TABLE IF EXISTS "character_sightings";
DROP TABLE IF EXISTS "characters";
DROP TABLE IF EXISTS "rpt_files";
