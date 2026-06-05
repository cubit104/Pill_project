CREATE TABLE IF NOT EXISTS public.drug_interactions_text (
    rxcui             VARCHAR(20) PRIMARY KEY,
    drug_name         TEXT,
    interactions_text TEXT,
    source            VARCHAR(20) DEFAULT 'openfda',
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.drug_interactions (
    id              SERIAL PRIMARY KEY,
    rxcui_1         VARCHAR(20) NOT NULL,
    rxcui_2         VARCHAR(20) NOT NULL,
    drug_name_1     TEXT,
    drug_name_2     TEXT,
    description     TEXT NOT NULL,
    severity        VARCHAR(10) CHECK (severity IN ('major', 'moderate', 'minor', 'unknown')),
    confidence      VARCHAR(10) CHECK (confidence IN ('high', 'medium', 'low')) DEFAULT 'medium',
    source_kaggle   BOOLEAN DEFAULT FALSE,
    source_openfda  BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(rxcui_1, rxcui_2)
);

CREATE INDEX IF NOT EXISTS idx_drug_interactions_rxcui_1 ON public.drug_interactions(rxcui_1);
CREATE INDEX IF NOT EXISTS idx_drug_interactions_rxcui_2 ON public.drug_interactions(rxcui_2);
CREATE INDEX IF NOT EXISTS idx_drug_interactions_severity ON public.drug_interactions(severity);
