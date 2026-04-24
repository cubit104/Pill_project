-- Backfill the has_image flag so it stays consistent with image_filename.
-- Historically has_image was only written by admin create/update endpoints,
-- so XML-imported rows had NULL despite having valid image_filename values.
-- This migration reconciles the two columns. The WHERE clause makes it a
-- no-op on re-run.
UPDATE pillfinder
SET has_image = CASE
    WHEN image_filename IS NOT NULL AND TRIM(image_filename) <> '' THEN 'TRUE'
    ELSE 'FALSE'
END
WHERE has_image IS DISTINCT FROM (
    CASE WHEN image_filename IS NOT NULL AND TRIM(image_filename) <> '' THEN 'TRUE' ELSE 'FALSE' END
);
