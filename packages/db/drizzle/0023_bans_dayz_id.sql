ALTER TABLE "bans" ADD COLUMN "dayz_id" text;
--> statement-breakpoint
UPDATE "bans" b SET "dayz_id" = p."dayz_id"
FROM "players" p
WHERE lower(p."gamertag") = lower(b."gamertag") AND p."dayz_id" IS NOT NULL;
