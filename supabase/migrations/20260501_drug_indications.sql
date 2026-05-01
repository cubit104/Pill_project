CREATE TABLE IF NOT EXISTS public.drug_indications (
    id                SERIAL PRIMARY KEY,
    drug_name_key     VARCHAR(255) UNIQUE NOT NULL,    -- lowercased generic, e.g. "ibuprofen"
    generic_name      VARCHAR(255),
    pharm_class       VARCHAR(255),
    indications_text  TEXT,                             -- raw FDA "indications_and_usage" text, full
    source            VARCHAR(20) NOT NULL DEFAULT 'openfda' CHECK (source IN ('openfda', 'manual')),  -- 'openfda' | 'manual'
    fetched_at        TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by        VARCHAR(255),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- updated_at auto-touch trigger
CREATE OR REPLACE FUNCTION public.trg_drug_indications_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS drug_indications_touch_updated_at ON public.drug_indications;
CREATE TRIGGER drug_indications_touch_updated_at
BEFORE UPDATE ON public.drug_indications
FOR EACH ROW EXECUTE FUNCTION public.trg_drug_indications_touch_updated_at();
