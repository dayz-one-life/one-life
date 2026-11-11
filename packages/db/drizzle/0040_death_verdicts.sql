-- Stored death verdicts (death-verdict plan step 5). Additive only: the previous release still
-- runs against this schema. Neither death_verdicts nor death_verdict_queue is a rebuild table:
-- both reference lives ON DELETE CASCADE, so `TRUNCATE lives ... CASCADE` empties them, and the
-- projector's sweep refills them from raw_lines. death_verdict_overrides is durable and keyed on
-- the resolved death line, which a rebuild does not move.
CREATE TABLE IF NOT EXISTS "death_verdicts" (
	"life_id" bigint PRIMARY KEY NOT NULL REFERENCES "lives"("id") ON DELETE CASCADE,
	"classifier_version" integer NOT NULL,
	"source" text DEFAULT 'classifier' NOT NULL,
	"settled_by" text NOT NULL,
	"death_file_id" bigint NOT NULL,
	"death_line_index" integer NOT NULL,
	"death_at" timestamp with time zone NOT NULL,
	"cause" text NOT NULL,
	"confidence" text NOT NULL,
	"mechanism_stated" boolean NOT NULL,
	"object_key" text,
	"object_class" text,
	"object_text" text,
	"upstream_cause" text,
	"upstream_confidence" text,
	"co_causes" text[] DEFAULT '{}' NOT NULL,
	"conditions" text[] DEFAULT '{}' NOT NULL,
	"attr_role" text,
	"attr_basis" text,
	"attr_dayz_id" text,
	"attr_gamertag" text,
	"attr_confidence" text,
	"rule" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"override_seen_at" timestamp with time zone,
	"classified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "death_verdicts_version_idx" ON "death_verdicts" USING btree ("classifier_version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "death_verdicts_line_idx" ON "death_verdicts" USING btree ("death_file_id", "death_line_index");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "death_verdict_queue" (
	"life_id" bigint PRIMARY KEY NOT NULL REFERENCES "lives"("id") ON DELETE CASCADE,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "death_verdict_overrides" (
	"server_id" integer NOT NULL,
	"death_file_id" bigint NOT NULL,
	"death_line_index" integer NOT NULL,
	"cause" text,
	"confidence" text,
	"object_key" text,
	"upstream_cause" text,
	"upstream_confidence" text,
	"credit" text,
	"credit_dayz_id" text,
	"note" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "death_verdict_overrides_pk" PRIMARY KEY ("death_file_id", "death_line_index")
);
--> statement-breakpoint
-- The sweep notices an edited override by comparing updated_at with the verdict's
-- override_seen_at, so updated_at must move on every write, whoever writes it.
CREATE OR REPLACE FUNCTION "death_verdict_overrides_touch"() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "death_verdict_overrides_touch" ON "death_verdict_overrides";
--> statement-breakpoint
CREATE TRIGGER "death_verdict_overrides_touch" BEFORE UPDATE ON "death_verdict_overrides"
  FOR EACH ROW EXECUTE FUNCTION "death_verdict_overrides_touch"();
--> statement-breakpoint
ALTER TABLE "kills" ADD COLUMN IF NOT EXISTS "basis" text DEFAULT 'kill_line' NOT NULL;
--> statement-breakpoint
ALTER TABLE "kills" ADD COLUMN IF NOT EXISTS "credit_source" text;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kills" ADD CONSTRAINT "kills_basis_chk" CHECK (
  ("basis" = 'kill_line' AND "credit_source" IS NULL) OR
  ("basis" = 'trap_placement' AND "credit_source" IN ('classifier', 'override')
   AND "killer_player_id" IS NOT NULL AND "victim_life_id" IS NOT NULL));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
