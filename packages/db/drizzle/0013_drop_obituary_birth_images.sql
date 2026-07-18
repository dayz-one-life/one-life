-- R5c images are retired for obituaries and birth notices (reserved for news/editorial).
-- Delete the stored image bytes and clear the provenance/retry fields on those two kinds.
DELETE FROM "article_images"
 WHERE "article_id" IN (
   SELECT "id" FROM "articles" WHERE "kind" IN ('obituary', 'birth_notice')
 );
--> statement-breakpoint
UPDATE "articles"
   SET "image_url" = NULL,
       "image_caption" = NULL,
       "image_prompt" = NULL,
       "image_kind" = NULL,
       "image_model" = NULL,
       "image_attempts" = 0,
       "image_error" = NULL
 WHERE "kind" IN ('obituary', 'birth_notice');
