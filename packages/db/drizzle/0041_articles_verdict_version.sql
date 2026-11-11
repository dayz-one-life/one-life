-- The classifier version of the death verdict an obituary was written from (death-verdict plan
-- step 8). NULL on every article written before the obituary-v4 prompt. Additive only: the
-- previous release still runs against this schema. Stale prose is found later with
-- `verdict_version IS NULL OR verdict_version < current` together with a changed public key.
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "verdict_version" integer;
