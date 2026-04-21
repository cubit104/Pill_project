-- Add idempotency_key column to pillfinder for safe admin pill creation deduplication.
-- This avoids reusing the meta_description field as a key store.
ALTER TABLE public.pillfinder
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE;
