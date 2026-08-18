DROP INDEX IF EXISTS "avatar_reports_reporter_subject_uniq";--> statement-breakpoint
ALTER TABLE "avatar_reports" ALTER COLUMN "subject_user_id" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "avatar_reports_reporter_hash_uniq" ON "avatar_reports" USING btree ("reporter_user_id","subject_hash");