-- Add image_alt_text and tags columns to pillfinder
-- Idempotent: uses ADD COLUMN IF NOT EXISTS

ALTER TABLE public.pillfinder
  ADD COLUMN IF NOT EXISTS image_alt_text TEXT;

ALTER TABLE public.pillfinder
  ADD COLUMN IF NOT EXISTS tags TEXT;
