DO $$
DECLARE dupes text;
BEGIN
  SELECT string_agg(dayz_id, ', ') INTO dupes
  FROM (SELECT dayz_id FROM players WHERE dayz_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1) x;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'players has duplicate dayz_id values, resolve by hand (or rebuild) first: %', dupes;
  END IF;
END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "players_dayz_id_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "players_dayz_id_uniq" ON "players" USING btree ("dayz_id");
