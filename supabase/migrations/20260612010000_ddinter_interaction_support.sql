ALTER TABLE public.drug_interactions
    ADD COLUMN IF NOT EXISTS source_ddinter BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS ddinter_id_a TEXT,
    ADD COLUMN IF NOT EXISTS ddinter_id_b TEXT,
    ADD COLUMN IF NOT EXISTS management TEXT;

CREATE TABLE IF NOT EXISTS public.drug_food_interactions (
    id BIGSERIAL PRIMARY KEY,
    drug_name TEXT NOT NULL,
    ddinter_id TEXT,
    food_name TEXT NOT NULL,
    level TEXT,
    interaction TEXT,
    management TEXT,
    ref_text TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.drug_disease_interactions (
    id BIGSERIAL PRIMARY KEY,
    drug_name TEXT NOT NULL,
    ddinter_id TEXT,
    disease_name TEXT NOT NULL,
    level TEXT,
    text TEXT,
    ref_text TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drug_interactions_source_ddinter
    ON public.drug_interactions (source_ddinter)
    WHERE source_ddinter;

CREATE INDEX IF NOT EXISTS idx_drug_food_interactions_drug_name_lower
    ON public.drug_food_interactions (LOWER(drug_name));

CREATE INDEX IF NOT EXISTS idx_drug_disease_interactions_drug_name_lower
    ON public.drug_disease_interactions (LOWER(drug_name));
