-- Add published column to pillfinder.
-- Existing rows default to true so they remain visible on the public site.
-- New bulk-uploaded drafts will be inserted with published = false.
ALTER TABLE public.pillfinder
  ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT true;
