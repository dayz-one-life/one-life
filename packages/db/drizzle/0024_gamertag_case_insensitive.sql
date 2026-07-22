DO $$
DECLARE dupes text;
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
END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "players_gamertag_uniq";
--> statement-breakpoint
CREATE UNIQUE INDEX "players_gamertag_uniq" ON "players" USING btree (lower("gamertag"));
--> statement-breakpoint
DROP INDEX IF EXISTS "gamertag_links_verified_uniq";
--> statement-breakpoint
CREATE UNIQUE INDEX "gamertag_links_verified_uniq" ON "gamertag_links" USING btree (lower("gamertag")) WHERE "gamertag_links"."status" = 'verified';
