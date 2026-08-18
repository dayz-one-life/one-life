ALTER TABLE "avatar_reports" DROP CONSTRAINT IF EXISTS "avatar_reports_subject_user_id_user_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "avatar_reports" ADD CONSTRAINT "avatar_reports_subject_user_id_user_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
