-- In The Paper: the two lookups behind "which published articles name this player".
-- Partial on status='published' because nothing else is ever surfaced, and expression-based
-- because both comparisons are case-insensitive.
CREATE INDEX IF NOT EXISTS "articles_subject_idx"
  ON "articles" (lower("gamertag"), "created_at" DESC)
  WHERE "status" = 'published';

CREATE INDEX IF NOT EXISTS "articles_killer_idx"
  ON "articles" (lower("facts"->>'killerGamertag'), "created_at" DESC)
  WHERE "status" = 'published' AND "facts"->>'killerGamertag' IS NOT NULL;
