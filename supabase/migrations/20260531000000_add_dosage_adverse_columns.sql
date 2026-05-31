-- Add dedicated columns backing the Dosage and Adverse Reactions tabs.
--
-- These columns already exist in the live Supabase database (added manually),
-- but were never captured in a committed migration. CI runs and fresh deploys
-- build the schema from this migrations directory, so without this file the new
-- /api/pill/{slug}/dosage and adverse-reactions endpoints — and the has_dosage /
-- has_adverse_reactions flag queries in routes/details.py — would fail with
-- 42703 UndefinedColumn against a migration-built schema.
--
-- IF NOT EXISTS keeps this idempotent and a no-op on databases that already
-- have the columns.
ALTER TABLE public.medication_guide
    ADD COLUMN IF NOT EXISTS dosage_administration TEXT,
    ADD COLUMN IF NOT EXISTS adverse_reactions     TEXT;
