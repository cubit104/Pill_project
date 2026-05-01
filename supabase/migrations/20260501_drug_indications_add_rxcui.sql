ALTER TABLE drug_indications
    ADD COLUMN IF NOT EXISTS rxcui      VARCHAR(20),
    ADD COLUMN IF NOT EXISTS rxcui_name VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_drug_indications_rxcui ON drug_indications(rxcui);
