CREATE TABLE "friendships" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "user_a" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "user_b" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "status" text NOT NULL,
  "requested_by" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "request_seq" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "responded_at" timestamp with time zone,
  "a_shares_location" boolean DEFAULT false NOT NULL,
  "b_shares_location" boolean DEFAULT false NOT NULL,
  "a_shares_presence" boolean DEFAULT false NOT NULL,
  "b_shares_presence" boolean DEFAULT false NOT NULL,
  CONSTRAINT "friendships_ordered" CHECK ("user_a" < "user_b")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "friendships_pair_uniq" ON "friendships" ("user_a","user_b");
--> statement-breakpoint
CREATE INDEX "friendships_recipient_idx" ON "friendships" ("user_b","status");
