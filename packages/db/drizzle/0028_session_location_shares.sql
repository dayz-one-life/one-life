-- Sub-project E: session-scoped location sharing.
--
-- Replaces F2's standing consent model wholesale. A grant is handed to ONE person, during ONE
-- game session, and dies with that session.
--
-- ⚠️ THE DROPS BELOW ARE DESTRUCTIVE AND DISCARD EVERY EXISTING LOCATION CONSENT DECISION.
-- That is the intent, not an oversight: consent given under a standing model ("my friends may
-- always see me") does not transfer to a session model, and silently carrying it forward would
-- be the worst possible reading of "replaces the consent model wholesale". Migrations 0018 and
-- 0022 created and defaulted these columns; this removes them.
--
-- ⚠️ `location_shares` is DURABLE. It must never appear in REBUILD_TRUNCATE_TABLES
-- (apps/projector/src/rebuild.ts) — rows self-invalidate, so a rebuild leaves rows that simply
-- stop matching, whereas truncating would revoke live shares mid-session.
--
-- Touches no projection table: deploy with a plain ./deploy/deploy.sh, NO --rebuild.

CREATE TABLE IF NOT EXISTS location_shares (
  id bigserial PRIMARY KEY,
  granter_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  grantee_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  server_id integer NOT NULL REFERENCES servers(id),
  -- The entire expiry mechanism: a snapshot of the granter's open session's connected_at.
  -- A TIMESTAMP, never sessions.id — ids are reassigned by a projection rebuild.
  granter_session_connected_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Re-granting in a later session UPDATES the snapshot rather than accumulating rows.
CREATE UNIQUE INDEX IF NOT EXISTS location_shares_grant_uniq
  ON location_shares (granter_user_id, grantee_user_id, server_id);

-- Serves the read path: "who has granted to ME on this server".
CREATE INDEX IF NOT EXISTS location_shares_grantee_idx
  ON location_shares (grantee_user_id, server_id);

ALTER TABLE friendships DROP COLUMN IF EXISTS a_shares_location;
ALTER TABLE friendships DROP COLUMN IF EXISTS b_shares_location;
ALTER TABLE user_preferences DROP COLUMN IF EXISTS share_location;
