-- =====================================================================
-- Drug Synonyms — Brand ↔ Generic name resolution
--
-- Purpose:
--   Stores the relationship between drug ingredients (generic names) and
--   all marketed brand names, so search can resolve either name to the
--   same set of pillfinder rows.
--
-- Design:
--   - drug_synonyms: one row per active ingredient (keyed by RxNorm
--     ingredient rxcui), holds generic_name + ALL brand_names as an
--     array. One ingredient → many brands.
--   - rxcui_to_ingredient: maps every product-level rxcui (the values
--     stored in pillfinder.rxcui — typically SCD/SBD/GPCK/BPCK tty) to
--     its parent ingredient rxcui.
--
-- This migration is purely additive:
--   - No changes to pillfinder
--   - No changes to existing data
--   - No code reads these tables yet; PR 2 will add a feature-flagged
--     search path that uses them.
--
-- No RLS: matches the project convention. The FastAPI backend connects
-- via SQLAlchemy (direct Postgres, not PostgREST), so auth.uid() is
-- always NULL and RLS WITH CHECK policies would break writes.
-- See supabase/migrations/20240101000009_disable_rls_on_admin_tables.sql
-- for the rationale.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------
-- drug_synonyms: one row per active ingredient
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.drug_synonyms (
  ingredient_rxcui   TEXT PRIMARY KEY,
  generic_name       TEXT NOT NULL,
  brand_names        TEXT[] NOT NULL DEFAULT '{}',
  source             TEXT NOT NULL DEFAULT 'rxnorm',
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.drug_synonyms IS
  'Brand <-> generic name lookup. One row per RxNorm ingredient rxcui. '
  'brand_names contains all marketed brand names for that ingredient.';
COMMENT ON COLUMN public.drug_synonyms.ingredient_rxcui IS
  'RxNorm rxcui of the active ingredient (tty=IN or MIN for combinations).';
COMMENT ON COLUMN public.drug_synonyms.generic_name IS
  'Canonical generic / non-proprietary name (e.g. "clopidogrel").';
COMMENT ON COLUMN public.drug_synonyms.brand_names IS
  'All marketed brand names for this ingredient, deduplicated. May be empty.';

CREATE INDEX IF NOT EXISTS idx_drug_synonyms_generic_lower
  ON public.drug_synonyms (LOWER(generic_name));

CREATE INDEX IF NOT EXISTS idx_drug_synonyms_brands_gin
  ON public.drug_synonyms USING GIN (brand_names);

CREATE INDEX IF NOT EXISTS idx_drug_synonyms_generic_trgm
  ON public.drug_synonyms USING GIN (LOWER(generic_name) gin_trgm_ops);

-- NOTE: an additional trigram index over array_to_string(brand_names, ' ')
-- was considered but rejected because array_to_string is STABLE, not
-- IMMUTABLE, and Postgres requires IMMUTABLE expressions in index
-- expressions. The GIN(brand_names) index above already supports fast
-- brand lookups via:
--     WHERE :name = ANY(brand_names)
-- or:
--     WHERE EXISTS (SELECT 1 FROM unnest(brand_names) bn WHERE LOWER(bn) LIKE :q)


-- ---------------------------------------------------------------------
-- rxcui_to_ingredient: maps pillfinder.rxcui -> ingredient_rxcui
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rxcui_to_ingredient (
  product_rxcui      TEXT PRIMARY KEY,
  ingredient_rxcui   TEXT NOT NULL
    REFERENCES public.drug_synonyms(ingredient_rxcui) ON DELETE CASCADE,
  product_tty        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.rxcui_to_ingredient IS
  'Maps each product-level rxcui (as stored on pillfinder rows) to its '
  'active ingredient rxcui in drug_synonyms.';
COMMENT ON COLUMN public.rxcui_to_ingredient.product_rxcui IS
  'Product-level rxcui — matches pillfinder.rxcui values (TEXT).';
COMMENT ON COLUMN public.rxcui_to_ingredient.ingredient_rxcui IS
  'FK to drug_synonyms.ingredient_rxcui — the active ingredient.';
COMMENT ON COLUMN public.rxcui_to_ingredient.product_tty IS
  'RxNorm term type of the product (SCD=generic, SBD=brand, GPCK, BPCK). '
  'Informational only; not enforced.';

CREATE INDEX IF NOT EXISTS idx_rxcui_to_ingredient_ing
  ON public.rxcui_to_ingredient (ingredient_rxcui);


-- ---------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_drug_synonyms_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS drug_synonyms_set_updated_at ON public.drug_synonyms;
CREATE TRIGGER drug_synonyms_set_updated_at
  BEFORE UPDATE ON public.drug_synonyms
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_drug_synonyms_set_updated_at();


-- ---------------------------------------------------------------------
-- Backfill audit log (mirrors scripts/backfill_rxcui_and_ndc11.py pattern)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.drug_synonyms_backfill_log (
  id                 BIGSERIAL PRIMARY KEY,
  ingredient_rxcui   TEXT,
  product_rxcui      TEXT,
  generic_name       TEXT,
  brand_count        INTEGER,
  outcome            TEXT,   -- inserted / updated / unchanged / skipped / no_match / error
  source             TEXT,   -- rxnorm endpoint used
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_synonyms_backfill_log_created
  ON public.drug_synonyms_backfill_log (created_at DESC);


-- ---------------------------------------------------------------------
-- RLS explicitly disabled to match project convention.
-- ---------------------------------------------------------------------
ALTER TABLE public.drug_synonyms              DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.rxcui_to_ingredient        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.drug_synonyms_backfill_log DISABLE ROW LEVEL SECURITY;
