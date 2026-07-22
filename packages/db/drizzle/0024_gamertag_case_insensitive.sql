DO $$
DECLARE dupes text; repaired bigint;
BEGIN
  SELECT string_agg(g, ', ') INTO dupes
  FROM (SELECT lower(gamertag) AS g FROM players GROUP BY 1 HAVING count(*) > 1) x;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'players has case-colliding gamertags, resolve by hand first: %', dupes;
  END IF;

  SELECT string_agg(g, ', ') INTO dupes
  FROM (SELECT lower(gamertag) AS g FROM gamertag_links WHERE status = 'verified'
        GROUP BY 1 HAVING count(*) > 1) x;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'gamertag_links has case-colliding verified links, resolve by hand first: %', dupes;
  END IF;

  -- Third precheck, and it exists solely to make the repair below safe.
  -- `gamertag_links_user_gamertag_uniq` is a case-SENSITIVE unique index on (user_id, gamertag)
  -- with no partial predicate, so ONE user may today hold e.g. a cancelled 'sasha' and a pending
  -- 'Sasha' (`gamertag_links_user_active_uniq` only constrains the *active* ones). Canonicalizing
  -- both onto the same players casing would violate it — either against a row that already holds
  -- the canonical casing, or between two mis-cased rows rewritten by the same statement. Both
  -- cases are exactly "one user, two links whose gamertags differ only by case", so aborting on
  -- that condition here leaves the UPDATE provably collision-free. Not auto-resolved: which of
  -- the two rows is the real claim is a judgement call, not a rule.
  SELECT string_agg(user_id || ':' || g, ', ') INTO dupes
  FROM (SELECT user_id, lower(gamertag) AS g FROM gamertag_links
        GROUP BY 1, 2 HAVING count(*) > 1) x;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'gamertag_links has case-colliding links for one user, resolve by hand first: %', dupes;
  END IF;

  -- Repair, not merely report. Rows claimed before this branch stored whatever casing the user
  -- typed; the new indexes accept those happily, but redeem.ts matches links to bans with a
  -- strict `=` against `bans.gamertag` (written from `players.gamertag`), so a mis-cased link
  -- costs that player their self-unban and their Verified stamp. Canonicalize at deploy time so
  -- the invariant is TRUE afterwards rather than assumed — the production audit that would have
  -- attested to it was taken from a pre-v0.37.2 dump.
  --
  -- This cannot itself collide: `gamertag_links_verified_uniq` is on lower(gamertag), which the
  -- UPDATE does not change; `gamertag_links_user_active_uniq` is on user_id alone; and
  -- `gamertag_links_user_gamertag_uniq` is guarded by the precheck immediately above. The join
  -- to `players` matches at most one row for the same reason (first precheck).
  UPDATE gamertag_links g SET gamertag = p.gamertag
  FROM players p
  WHERE lower(g.gamertag) = lower(p.gamertag)
    AND g.gamertag <> p.gamertag;
  GET DIAGNOSTICS repaired = ROW_COUNT;
  RAISE NOTICE 'gamertag_links: canonicalized % mis-cased link(s) to their players casing', repaired;
END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "players_gamertag_uniq";
--> statement-breakpoint
CREATE UNIQUE INDEX "players_gamertag_uniq" ON "players" USING btree (lower("gamertag"));
--> statement-breakpoint
DROP INDEX IF EXISTS "gamertag_links_verified_uniq";
--> statement-breakpoint
CREATE UNIQUE INDEX "gamertag_links_verified_uniq" ON "gamertag_links" USING btree (lower("gamertag")) WHERE "gamertag_links"."status" = 'verified';
