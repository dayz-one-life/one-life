ALTER TABLE "gamertag_links" DROP CONSTRAINT "gamertag_links_server_id_servers_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "gamertag_links_user_server_gamertag_uniq";--> statement-breakpoint
DROP INDEX IF EXISTS "gamertag_links_server_gamertag_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "gamertag_links_verified_uniq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gamertag_links_user_gamertag_uniq" ON "gamertag_links" USING btree ("user_id","gamertag");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gamertag_links_gamertag_idx" ON "gamertag_links" USING btree ("gamertag");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gamertag_links_verified_uniq" ON "gamertag_links" USING btree ("gamertag") WHERE "gamertag_links"."status" = 'verified';--> statement-breakpoint
ALTER TABLE "gamertag_links" DROP COLUMN IF EXISTS "server_id";