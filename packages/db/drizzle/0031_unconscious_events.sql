-- Mauled inference: record when a player was knocked unconscious.
-- Infected deal SHOCK, which never appears in the ADM `[HP: …]` field, so a player can be
-- knocked out at near-full health and then killed by DayZ for logging out unconscious. This
-- line is the evidence that an infected mauling turned lethal; `bleedSources` and HP both miss it.
--
-- PROJECTION table: rebuilt from the event log, NOT in APP_TABLES.
-- ⚠️ Deliberately NOT added to REBUILD_TRUNCATE_TABLES — the FK to `players` means
-- TRUNCATE players … RESTART IDENTITY CASCADE already clears it. Naming a newly-created table
-- in that list aborts the rebuild phase (which runs BEFORE migrate) and kills the deploy
-- mid-flight with the fleet already stopped.
CREATE TABLE "unconscious_events" (
  "id" bigserial PRIMARY KEY,
  "server_id" integer NOT NULL REFERENCES "servers"("id"),
  "player_id" bigint NOT NULL REFERENCES "players"("id"),
  "gamertag" text NOT NULL,
  "disconnecting" boolean NOT NULL DEFAULT false,
  "occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "unconscious_events_player_idx" ON "unconscious_events" ("server_id", "player_id", "occurred_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "unconscious_events_natural_uniq" ON "unconscious_events" ("server_id", "player_id", "occurred_at");
