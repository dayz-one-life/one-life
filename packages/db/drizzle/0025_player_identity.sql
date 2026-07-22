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
-- players.gamertag is a CURRENT LABEL now, not an identity: identity is dayz_id, and the alias
-- history lives in player_gamertags. A UNIQUE index here is therefore wrong in both directions —
-- a rename can raise 23505 inside the fold transaction (which an event-log fold retries forever,
-- stopping every projection), and the recycling end state legitimately has two identities whose
-- current label is the same string. Replaced with a plain index; slug resolution still needs it.
--
-- No unique index on dayz_id here on purpose: deploy.sh migrates BEFORE it rebuilds, so the
-- duplicate hashes produced by the old gamertag-keyed fold still exist when this runs and a
-- unique would abort the deploy. That promotion is migration 0026, next release.
DROP INDEX IF EXISTS "players_gamertag_uniq";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "players_gamertag_idx" ON "players" USING btree (lower("gamertag"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kills_killer_player_idx" ON "kills" USING btree ("server_id", "killer_player_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hit_events_victim_player_idx" ON "hit_events" USING btree ("server_id", "victim_player_id");
