CREATE TABLE IF NOT EXISTS "player_gamertags" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "player_id" bigint NOT NULL REFERENCES "players"("id") ON DELETE CASCADE,
  "gamertag" text NOT NULL,
  "first_seen_at" timestamp with time zone NOT NULL,
  "last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "player_gamertags_player_name_uniq" ON "player_gamertags" USING btree ("player_id", lower("gamertag"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "player_gamertags_name_idx" ON "player_gamertags" USING btree (lower("gamertag"), "last_seen_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "players_dayz_id_idx" ON "players" USING btree ("dayz_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kills_killer_player_idx" ON "kills" USING btree ("server_id", "killer_player_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hit_events_victim_player_idx" ON "hit_events" USING btree ("server_id", "victim_player_id");
