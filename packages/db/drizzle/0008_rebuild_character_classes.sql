-- Rebuild the `characters` rollup from the authoritative create_entity signal only.
--
-- Background: the `head_asset` class source was unreliable — head-warning log lines carry no
-- player identity and mis-attribute across players (even cross-gender), so a character's rolled-up
-- class could be a wrong persona (e.g. Mirek shown as the phantom "Adam"). The parser no longer
-- emits head_asset, but existing rollup rows were computed from it. This one-time correction
-- recomputes character_class using only create_entity sightings, and clears any class that had no
-- create_entity backing (those characters become "unknown" → silhouette in the UI).
--
-- Note: create_entity is stable per charId, so we collapse to one class per (server_id, char_id)
-- across epochs rather than matching each firstSeenAt epoch individually.

-- 1) Set the authoritative create_entity class wherever one exists (earliest wins).
UPDATE characters c
SET character_class = sub.cls
FROM (
  SELECT DISTINCT ON (cs.server_id, cs.char_id)
         cs.server_id, cs.char_id, cs.character_class AS cls
  FROM character_sightings cs
  WHERE cs.class_source = 'create_entity' AND cs.character_class IS NOT NULL
  ORDER BY cs.server_id, cs.char_id, cs.observed_at
) sub
WHERE c.server_id = sub.server_id
  AND c.char_id = sub.char_id
  AND c.character_class IS DISTINCT FROM sub.cls;
--> statement-breakpoint

-- 2) Clear classes that were only ever derived from head_asset (no create_entity backing).
UPDATE characters c
SET character_class = NULL
WHERE c.character_class IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM character_sightings cs
    WHERE cs.server_id = c.server_id
      AND cs.char_id = c.char_id
      AND cs.class_source = 'create_entity'
      AND cs.character_class IS NOT NULL
  );
