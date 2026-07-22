-- F1 review finding #2: the friend-request rate limit counts notifications by prefix match
-- on natural_key. `starts_with(natural_key, $prefix)` is an ordinary function call, so the
-- planner cannot turn it into an index range scan against a default-collation btree index —
-- this query runs on every single friend request, against a table with no bound across all
-- players and all notification kinds.
--
-- text_pattern_ops supports an index range scan for `LIKE 'prefix%'` (packages/friends/src/
-- mutations.ts switched the predicate accordingly, with the prefix escaped for %, _, and \).
CREATE INDEX IF NOT EXISTS "notifications_natural_key_pattern_idx"
  ON "notifications" ("natural_key" text_pattern_ops);
