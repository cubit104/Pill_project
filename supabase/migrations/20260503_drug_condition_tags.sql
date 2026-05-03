CREATE TABLE IF NOT EXISTS public.drug_condition_tags (
    id          SERIAL PRIMARY KEY,
    rxcui       VARCHAR(20) NOT NULL,
    drug_name   VARCHAR(255) NOT NULL,   -- medicine_name lowercased, for display
    tag         VARCHAR(100) NOT NULL,   -- e.g. 'heart attack', 'blood pressure'
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(rxcui, tag)
);
CREATE INDEX IF NOT EXISTS idx_drug_condition_tags_tag ON public.drug_condition_tags(tag);
CREATE INDEX IF NOT EXISTS idx_drug_condition_tags_rxcui ON public.drug_condition_tags(rxcui);
