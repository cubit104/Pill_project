CREATE TABLE IF NOT EXISTS drug_medication_guides (
    id                  BIGSERIAL PRIMARY KEY,
    rxcui               TEXT,
    ndc                 TEXT,
    spl_set_id          TEXT,
    generic_name        TEXT,
    brand_name          TEXT,
    has_boxed_warning   BOOLEAN DEFAULT FALSE,
    overview            TEXT,
    uses                TEXT,
    dosage              TEXT,
    how_to_take         TEXT,
    side_effects        TEXT,
    warnings            TEXT,
    interactions        TEXT,
    contraindications   TEXT,
    special_populations TEXT,
    overdose            TEXT,
    storage             TEXT,
    pharmacology        TEXT,
    manufacturer        TEXT,
    source_url          TEXT,
    disclaimer          TEXT,
    fetched_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE drug_medication_guides
    ADD COLUMN IF NOT EXISTS professional_html TEXT,
    ADD COLUMN IF NOT EXISTS patient_html      TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'drug_medication_guides_rxcui_key'
    ) THEN
        ALTER TABLE drug_medication_guides
            ADD CONSTRAINT drug_medication_guides_rxcui_key UNIQUE (rxcui);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_dmg_rxcui      ON drug_medication_guides(rxcui);
CREATE INDEX IF NOT EXISTS idx_dmg_ndc        ON drug_medication_guides(ndc);
CREATE INDEX IF NOT EXISTS idx_dmg_spl_set_id ON drug_medication_guides(spl_set_id);
