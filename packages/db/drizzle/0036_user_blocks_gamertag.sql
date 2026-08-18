ALTER TABLE "user_blocks" ADD COLUMN "blocked_gamertag" text;
UPDATE "user_blocks" ub SET "blocked_gamertag" = COALESCE(
  (SELECT gl.gamertag FROM "gamertag_links" gl
    WHERE gl.user_id = ub.blocked_user_id AND gl.status = 'verified' LIMIT 1),
  '(unknown)');
ALTER TABLE "user_blocks" ALTER COLUMN "blocked_gamertag" SET NOT NULL;
