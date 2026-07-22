ALTER TABLE "user_preferences" ADD COLUMN "share_location" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "friendships" ALTER COLUMN "a_shares_location" SET DEFAULT true;
--> statement-breakpoint
ALTER TABLE "friendships" ALTER COLUMN "b_shares_location" SET DEFAULT true;
--> statement-breakpoint
UPDATE "friendships" SET "a_shares_location" = true, "b_shares_location" = true;
