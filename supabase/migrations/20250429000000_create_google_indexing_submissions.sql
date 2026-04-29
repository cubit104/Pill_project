-- Migration: create google_indexing_submissions table
CREATE TABLE IF NOT EXISTS google_indexing_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pill_id TEXT,
  url TEXT NOT NULL,
  submitted_by UUID,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  response_status TEXT,
  response_raw JSONB
);

CREATE INDEX IF NOT EXISTS idx_gis_submitted_at ON google_indexing_submissions (submitted_at);
CREATE INDEX IF NOT EXISTS idx_gis_url ON google_indexing_submissions (url);
