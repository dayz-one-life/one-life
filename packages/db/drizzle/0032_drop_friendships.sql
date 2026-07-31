-- v0.69: friends feature removed (spec 2026-07-30). Durable-table drop — deliberate and
-- irreversible. location_shares / session_location_shares are NOT touched: map sharing
-- runs on session-scoped grants, which survive the friends teardown.
DROP TABLE IF EXISTS "friendships";
--> statement-breakpoint
DROP TABLE IF EXISTS "user_preferences";
