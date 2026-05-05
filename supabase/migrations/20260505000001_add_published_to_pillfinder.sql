-- Add published column to pillfinder.
-- Existing rows default to true so they remain visible on the public site.
-- The published flag is set to true when a pill is directly inserted (bulk publish)
-- or when a draft is approved and published via the admin workflow.
ALTER TABLE public.pillfinder
  ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT true;
