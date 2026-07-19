ALTER TABLE "lives" ADD COLUMN IF NOT EXISTS "qualified_at" timestamp with time zone;
CREATE INDEX IF NOT EXISTS "lives_qualified_at_idx" ON "lives" ("qualified_at") WHERE "qualified_at" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "kind" text NOT NULL,
  "natural_key" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "href" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "read_at" timestamp with time zone,
  "pushed_at" timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "notifications_natural_key_uniq" ON "notifications" ("natural_key");
CREATE INDEX IF NOT EXISTS "notifications_user_created_idx" ON "notifications" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "notifications_unpushed_idx" ON "notifications" ("created_at") WHERE "pushed_at" IS NULL;

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "user_agent" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "failure_count" integer DEFAULT 0 NOT NULL,
  "disabled_at" timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_uniq" ON "push_subscriptions" ("endpoint");
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_idx" ON "push_subscriptions" ("user_id");
