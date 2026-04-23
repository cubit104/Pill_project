-- Migration: prefix admin-uploaded image filenames with their pill_id/
--
-- Admin uploads store files in Supabase Storage at path {pill_id}/{filename},
-- but previously only the bare {filename} was written to pillfinder.image_filename.
-- This migration adds the pill_id/ prefix for rows that match the new-upload
-- naming pattern: ^{first-8-of-uuid}-{unix-timestamp}.{ext}$
--
-- Safe rules:
--   1. Only update parts that do NOT already contain a '/' (idempotent).
--   2. Only update parts whose name matches ^[0-9a-f]{8}-[0-9]+\.(jpg|jpeg|png|webp)$
--      AND starts with the first 8 hex chars of the pill's own id.
--      This leaves legacy filenames (NDC_xxx.jpg, 12345678.jpg, etc.) untouched.
--
-- The UPDATE is idempotent: re-running it produces no additional changes because
-- parts that already contain '/' are left as-is by the CASE expression.

UPDATE pillfinder
SET image_filename = (
  SELECT string_agg(
    CASE
      WHEN trim(part) != ''
           AND trim(part) NOT LIKE '%/%'
           AND trim(part) ~ ('^' || LEFT(id::text, 8) || '-[0-9]+\.(jpg|jpeg|png|webp)$')
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
