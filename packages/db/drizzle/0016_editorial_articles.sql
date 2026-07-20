-- The editorial desk writes institutional articles — an Almanac census covering every server, a
-- Ledger item about a token transfer between two people — which have no single (server, gamertag,
-- life) subject. Before this, storing one meant inventing a fake subject that the web surface would
-- then render, link, and index as though it were a real player.
--
-- Only these five columns relax. The partial unique index
-- `articles_kind_server_gamertag_life_uniq` covers `kind IN ('obituary','birth_notice')` only, and
-- both of those writers always supply a full tuple, so no NULL can enter the constraint's domain.
-- The `server_id` FK tolerates NULL natively. `articles` is durable, so no --rebuild.
ALTER TABLE "articles" ALTER COLUMN "server_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "articles" ALTER COLUMN "gamertag" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "articles" ALTER COLUMN "map" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "articles" ALTER COLUMN "life_number" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "articles" ALTER COLUMN "life_started_at" DROP NOT NULL;
