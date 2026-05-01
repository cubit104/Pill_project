-- Idempotent. Safe to re-run.
-- Adds MedlinePlus columns to drug_indications.
ALTER TABLE drug_indications
  ADD COLUMN IF NOT EXISTS rxcui VARCHAR(20),
  ADD COLUMN IF NOT EXISTS plain_text TEXT,
  ADD COLUMN IF NOT EXISTS source_url TEXT;

-- Unique constraint on rxcui (one drug_indications row per RxCUI).
-- Use DO block so it's idempotent across re-runs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'drug_indications_rxcui_key'
  ) THEN
    ALTER TABLE drug_indications ADD CONSTRAINT drug_indications_rxcui_key UNIQUE (rxcui);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_drug_indications_rxcui ON drug_indications(rxcui);

-- Extend the source CHECK constraint to allow 'medlineplus'.
-- Drops the old constraint (if present) and recreates it with the updated list.
DO $$
DECLARE
  _conname TEXT;
BEGIN
  SELECT conname INTO _conname
  FROM pg_constraint
  WHERE conrelid = 'drug_indications'::regclass
    AND contype = 'c'
    AND conname LIKE '%source%';

  IF _conname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE drug_indications DROP CONSTRAINT ' || quote_ident(_conname);
  END IF;

  ALTER TABLE drug_indications
    ADD CONSTRAINT drug_indications_source_check
    CHECK (source IN ('openfda', 'manual', 'medlineplus'));
END$$;
