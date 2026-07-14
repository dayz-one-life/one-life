ALTER TABLE "players" DROP CONSTRAINT "players_server_id_servers_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "players_server_gamertag_uniq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "players_gamertag_uniq" ON "players" USING btree ("gamertag");--> statement-breakpoint
ALTER TABLE "players" DROP COLUMN IF EXISTS "server_id";--> statement-breakpoint
ALTER TABLE "players" DROP COLUMN IF EXISTS "current_life_id";