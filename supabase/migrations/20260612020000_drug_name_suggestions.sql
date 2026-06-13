-- Creates a pre-computed lookup table for the drug name suggestions endpoint.
-- Replaces the slow 4-UNION LIKE scan over drug_interactions (160K+ rows) with
-- a single indexed prefix query.
--
-- To refresh after future data imports, run the repopulation query in
-- scripts/README.md#drug-name-suggestions-refresh.

CREATE TABLE IF NOT EXISTS public.drug_name_suggestions (
    name       TEXT PRIMARY KEY,
    lower_name TEXT NOT NULL
);

INSERT INTO public.drug_name_suggestions (name, lower_name)
SELECT DISTINCT name, LOWER(name) AS lower_name
FROM (
    SELECT drug_name_1 AS name
    FROM public.drug_interactions
    WHERE drug_name_1 IS NOT NULL AND drug_name_1 <> ''
    UNION
    SELECT drug_name_2 AS name
    FROM public.drug_interactions
    WHERE drug_name_2 IS NOT NULL AND drug_name_2 <> ''
    UNION
    SELECT generic_name AS name
    FROM public.drug_synonyms
    WHERE generic_name IS NOT NULL AND generic_name <> ''
    UNION
    SELECT bn AS name
    FROM public.drug_synonyms, unnest(brand_names) AS bn
    WHERE bn IS NOT NULL AND bn <> ''
) combined
ON CONFLICT (name) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_drug_name_suggestions_lower_name
    ON public.drug_name_suggestions (lower_name text_pattern_ops);
