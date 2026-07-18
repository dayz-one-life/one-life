CREATE TABLE IF NOT EXISTS "article_images" (
	"article_id" bigint PRIMARY KEY NOT NULL,
	"bytes" "bytea" NOT NULL,
	"content_type" text NOT NULL,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "image_caption" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "image_model" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "image_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "image_error" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "article_images" ADD CONSTRAINT "article_images_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_image_missing_idx" ON "articles" USING btree ("created_at") WHERE "articles"."status" = 'published' AND "articles"."image_url" IS NULL;