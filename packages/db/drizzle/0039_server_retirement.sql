ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "ingest_from" timestamp with time zone;--> statement-breakpoint
DROP INDEX IF EXISTS "servers_nitrado_service_id_uniq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "servers_nitrado_service_id_active_uniq" ON "servers" USING btree ("nitrado_service_id") WHERE "servers"."active";
