-- Drop obsolete UNIQUE constraint on drug_name_key.
-- rxcui is now the proper unique key (added in earlier migration).
-- Multiple RxCUIs (different strengths) legitimately share the same drug_name_key.
-- Idempotent: safe to re-run.
ALTER TABLE drug_indications 
  DROP CONSTRAINT IF EXISTS drug_indications_drug_name_key_key;

-- Keep an index on drug_name_key for lookups (was previously implicit via UNIQUE).
CREATE INDEX IF NOT EXISTS idx_drug_indications_drug_name_key 
  ON drug_indications(drug_name_key);
