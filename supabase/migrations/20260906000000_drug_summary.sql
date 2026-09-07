-- drug_summary: one row per drug (grouped case-insensitively by medicine_name)
-- for the mobile app's drug lookup, live suggestions and strength picker.
-- Additive: nothing on the website reads it. See routes/drug_search.py.
--
-- Freshness: a statement-level trigger on pillfinder flips drug_summary_state.stale;
-- the API refreshes the view (CONCURRENTLY, ~1 s for 14K pills) on the next read.
-- Manual refresh: SELECT public.refresh_drug_summary();

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Canonical dose label from the free-text spl_strength column, so
-- "WARFARIN SODIUM 3 mg;", "3 MG" and "3 mg" all become "3 mg", and
-- "AMOXICILLIN 875 mg; CLAVULANATE 125 mg;" becomes "875 mg / 125 mg".
-- Falls back to the trimmed raw text when no dose token is found.
CREATE OR REPLACE FUNCTION public.strength_label(raw text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT COALESCE(
        NULLIF(
            array_to_string(ARRAY(
                SELECT replace(replace(replace(replace(
                           lower(regexp_replace(m[1], '\s+', ' ', 'g')),
                           ' ml', ' mL'), '/ml', '/mL'), ' meq', ' mEq'), ' iu', ' IU')
                FROM regexp_matches(
                    raw,
                    '(\d+(?:\.\d+)?\s*(?:mcg|mg|ug|g|ml|%|units?|iu|meq|mmol|\[[^\]]+\])(?:\s*/\s*(?:\d+(?:\.\d+)?\s*)?(?:mcg|mg|ug|g|ml|hr|h|day|dose|actuation|kg|m2|spray|puff|tablet|capsule)\M)?)',
                    'gi'
                ) AS m
            ), ' / '),
            ''
        ),
        NULLIF(regexp_replace(btrim(raw), '\s+', ' ', 'g'), '')
    )
$$;

CREATE MATERIALIZED VIEW IF NOT EXISTS public.drug_summary AS
WITH base AS (
    SELECT
        lower(btrim(medicine_name))              AS key,
        btrim(medicine_name)                     AS name,
        public.strength_label(spl_strength)      AS strength,
        NULLIF(btrim(brand_names), '')           AS brand_names,
        NULLIF(btrim(spl_ingredients), '')       AS ingredients,
        NULLIF(btrim(image_filename), '')        AS image_filename,
        slug,
        NULLIF(btrim(rxcui), '')                 AS rxcui
    FROM public.pillfinder
    WHERE deleted_at IS NULL
      AND published = true
      AND medicine_name IS NOT NULL
      AND btrim(medicine_name) <> ''
),
strengths AS (
    -- Distinct dose labels per drug, ordered numerically ("2.5 mg" before "10 mg").
    SELECT key, array_agg(strength ORDER BY num NULLS LAST, strength) AS strengths
    FROM (
        SELECT DISTINCT key, strength,
               NULLIF(substring(strength FROM '\d+(?:\.\d+)?'), '')::numeric AS num
        FROM base
        WHERE strength IS NOT NULL
    ) s
    GROUP BY key
)
SELECT
    b.key,
    (array_agg(b.name ORDER BY (b.name ~ '^[A-Z]') DESC, b.name))[1]                                  AS name,
    mode() WITHIN GROUP (ORDER BY b.brand_names)                                                      AS brand_names,
    mode() WITHIN GROUP (ORDER BY b.ingredients)                                                      AS ingredients,
    COUNT(*)::int                                                                                     AS pill_count,
    COALESCE(s.strengths, ARRAY[]::text[])                                                            AS strengths,
    (array_agg(b.image_filename ORDER BY b.slug) FILTER (WHERE b.image_filename IS NOT NULL))[1]      AS image_filename,
    (array_agg(b.slug ORDER BY b.slug) FILTER (WHERE b.slug IS NOT NULL))[1]                          AS slug,
    (array_agg(b.rxcui ORDER BY b.rxcui) FILTER (WHERE b.rxcui IS NOT NULL))[1]                       AS rxcui
FROM base b
LEFT JOIN strengths s USING (key)
GROUP BY b.key, s.strengths;

CREATE UNIQUE INDEX IF NOT EXISTS drug_summary_key_idx        ON public.drug_summary (key);
CREATE INDEX IF NOT EXISTS drug_summary_key_prefix_idx        ON public.drug_summary (key text_pattern_ops);
CREATE INDEX IF NOT EXISTS drug_summary_key_trgm_idx          ON public.drug_summary USING gin (key gin_trgm_ops);
CREATE INDEX IF NOT EXISTS drug_summary_pill_count_idx        ON public.drug_summary (pill_count DESC);

-- NDC prefix suggestions type digits without dashes; ndc11 already has this index.
CREATE INDEX IF NOT EXISTS idx_pf_ndc9_nodash ON public.pillfinder (replace(ndc9, '-', ''));

-- Single-row staleness flag, flipped by a statement trigger on pillfinder.
CREATE TABLE IF NOT EXISTS public.drug_summary_state (
    id           boolean PRIMARY KEY DEFAULT true CHECK (id),
    stale        boolean NOT NULL DEFAULT false,
    refreshed_at timestamptz
);
INSERT INTO public.drug_summary_state (id, stale, refreshed_at)
VALUES (true, false, now())
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.mark_drug_summary_stale() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE public.drug_summary_state SET stale = true WHERE id;
    RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS pillfinder_drug_summary_stale ON public.pillfinder;
CREATE TRIGGER pillfinder_drug_summary_stale
    AFTER INSERT OR UPDATE OR DELETE ON public.pillfinder
    FOR EACH STATEMENT EXECUTE FUNCTION public.mark_drug_summary_stale();

CREATE OR REPLACE FUNCTION public.refresh_drug_summary() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.drug_summary;
    UPDATE public.drug_summary_state SET stale = false, refreshed_at = now() WHERE id;
END
$$;
