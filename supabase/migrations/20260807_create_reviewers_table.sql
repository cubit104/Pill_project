-- Migration: Create reviewers table
-- Note: This table may already exist in production. This file is for repo reference.

CREATE TABLE IF NOT EXISTS public.reviewers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  credentials TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'medical_reviewer' CHECK (role IN ('author', 'medical_reviewer', 'editor', 'fact_checker')),
  bio TEXT DEFAULT '',
  avatar_url TEXT,
  specialty TEXT,
  same_as TEXT[] DEFAULT '{}',
  license_info TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_reviewers_slug ON public.reviewers (slug) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_reviewers_active ON public.reviewers (is_active) WHERE is_active = true;

-- Auto-update updated_at on changes
CREATE OR REPLACE FUNCTION public.trg_reviewers_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reviewers_touch_updated_at ON public.reviewers;
CREATE TRIGGER reviewers_touch_updated_at
    BEFORE UPDATE ON public.reviewers
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_reviewers_touch_updated_at();

-- No RLS (admin-only, accessed via service role like other admin tables)
ALTER TABLE public.reviewers DISABLE ROW LEVEL SECURITY;
