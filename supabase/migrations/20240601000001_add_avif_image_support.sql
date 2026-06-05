-- Migration: add AVIF image support to image_filename path prefix backfill
--
-- Extends the logic from 20240101000008_pillfinder_image_path_prefix.sql to
-- also handle .avif files that may have been uploaded before this migration.
-- The regex now includes 'avif' alongside jpg|jpeg|png|webp.
--
-- Safe rules (same as the original migration):
--   1. Only updates parts that do NOT already contain a '/' (idempotent).
--   2. Only updates parts whose name matches
--      ^{first-8-of-uuid}-{unix-timestamp}.(jpg|jpeg|png|avif|webp)$
--      AND starts with the first 8 hex chars of the pill's own id.
--      Legacy filenames (NDC_xxx.jpg, 12345678.jpg, etc.) are left untouched.

UPDATE public.pillfinder
SET image_filename = (
  SELECT string_agg(
    CASE
      WHEN trim(part) != ''
           AND trim(part) NOT LIKE '%/%'
           AND trim(part) ~ ('^' || LEFT(id::text, 8) || '-[0-9]+\.(jpg|jpeg|png|avif|webp)$')
      THEN id::text || '/' || trim(part)
      ELSE trim(part)
    END,
    ','
    ORDER BY ord
  )
  FROM unnest(string_to_array(image_filename, ',')) WITH ORDINALITY AS u(part, ord)
  WHERE trim(part) != ''
)
WHERE image_filename IS NOT NULL
  AND image_filename != ''
  AND deleted_at IS NULL;
