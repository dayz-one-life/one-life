-- Retire the content engine. Release 1 (v0.44.0) removed every reader of these tables; this drops
-- them.
--
-- article_images is dropped FIRST: its article_id FK references articles, and ON DELETE CASCADE
-- governs row deletion, not DROP TABLE — dropping articles first would fail on the dependency.
DROP TABLE IF EXISTS article_images;
DROP TABLE IF EXISTS articles;

-- The two article notification kinds no longer have interior routes to link to. `notifications`
-- is durable and never truncated by a projection rebuild, so these rows would otherwise sit in
-- players' inboxes pointing at 404s.
DELETE FROM notifications WHERE kind IN ('obituary_published', 'birth_notice_published');
