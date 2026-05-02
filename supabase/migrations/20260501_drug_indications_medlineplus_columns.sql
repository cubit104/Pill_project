-- Idempotent. Safe to re-run.
-- Adds MedlinePlus columns to drug_indications.
ALTER TABLE public.drug_indications
  ADD COLUMN IF NOT EXISTS rxcui VARCHAR(20),
  ADD COLUMN IF NOT EXISTS plain_text TEXT,
  ADD COLUMN IF NOT EXISTS source_url TEXT;

-- Unique constraint on rxcui (one drug_indications row per RxCUI).
-- Use DO block so it's idempotent across re-runs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'drug_indications_rxcui_key'
      AND conrelid = 'public.drug_indications'::regclass
  ) THEN
    ALTER TABLE public.drug_indications ADD CONSTRAINT drug_indications_rxcui_key UNIQUE (rxcui);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_drug_indications_rxcui ON public.drug_indications(rxcui);

-- Extend the source CHECK constraint to allow 'medlineplus'.
-- Drop by explicit name (idempotent via IF EXISTS) then recreate with the full list.
ALTER TABLE public.drug_indications
  DROP CONSTRAINT IF EXISTS drug_indications_source_check;

ALTER TABLE public.drug_indications
  ADD CONSTRAINT drug_indications_source_check
  CHECK (source IN ('openfda', 'manual', 'medlineplus'));
