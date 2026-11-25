-- The club gallery (spec docs/superpowers/specs/2026-11-23-club-gallery-design.md): a website photo
-- can now come from the gallery. On its own so the new value is committed before
-- 20271000000100_gallery.sql uses it.
alter type public.site_photo_source add value if not exists 'gallery';
