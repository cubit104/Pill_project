-- drug_summary v2: adds strength_details (per strength: pill count, one image, one
-- slug) so the app's strength picker can show a thumbnail and open single-pill
-- strengths directly. Rebuilds the view; state table, trigger and refresh function
-- from 20260906000000_drug_summary.sql are unchanged.

DROP MATERIALIZED VIEW IF EXISTS public.drug_summary;

CREATE MATERIALIZED VIEW public.drug_summary AS
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
per_strength AS (
    -- One representative pill per strength: thumbnail and slug come from the SAME
    -- row (one with a slug, preferably with an image), so the picture matches what opens.
    SELECT
        key,
        strength,
        pill_count,
        pick ->> 'image_filename' AS image_filename,
        pick ->> 'slug'           AS slug,
        num
    FROM (
        SELECT
            key,
            strength,
            COUNT(*)::int AS pill_count,
            (array_agg(jsonb_build_object('image_filename', image_filename, 'slug', slug)
                       ORDER BY (slug IS NULL), (image_filename IS NULL), slug))[1] AS pick,
            NULLIF(substring(strength FROM '\d+(?:\.\d+)?'), '')::numeric AS num
        FROM base
        WHERE strength IS NOT NULL
        GROUP BY key, strength
    ) g
),
strengths AS (
    -- Distinct dose labels per drug, ordered numerically ("2.5 mg" before "10 mg").
    SELECT
        key,
        array_agg(strength ORDER BY num NULLS LAST, strength) AS strengths,
        jsonb_agg(
            jsonb_build_object('label', strength, 'pill_count', pill_count, 'image_filename', image_filename, 'slug', slug)
            ORDER BY num NULLS LAST, strength
        ) AS strength_details
    FROM per_strength
    GROUP BY key
)
SELECT
    b.key,
    (array_agg(b.name ORDER BY (b.name ~ '^[A-Z]') DESC, b.name))[1]                                  AS name,
    mode() WITHIN GROUP (ORDER BY b.brand_names)                                                      AS brand_names,
    mode() WITHIN GROUP (ORDER BY b.ingredients)                                                      AS ingredients,
    COUNT(*)::int                                                                                     AS pill_count,
    COALESCE(s.strengths, ARRAY[]::text[])                                                            AS strengths,
    COALESCE(s.strength_details, '[]'::jsonb)                                                         AS strength_details,
    (array_agg(b.image_filename ORDER BY b.slug) FILTER (WHERE b.image_filename IS NOT NULL))[1]      AS image_filename,
    (array_agg(b.slug ORDER BY b.slug) FILTER (WHERE b.slug IS NOT NULL))[1]                          AS slug,
    (array_agg(b.rxcui ORDER BY b.rxcui) FILTER (WHERE b.rxcui IS NOT NULL))[1]                       AS rxcui
FROM base b
LEFT JOIN strengths s USING (key)
GROUP BY b.key, s.strengths, s.strength_details;

CREATE UNIQUE INDEX IF NOT EXISTS drug_summary_key_idx        ON public.drug_summary (key);
CREATE INDEX IF NOT EXISTS drug_summary_key_prefix_idx        ON public.drug_summary (key text_pattern_ops);
CREATE INDEX IF NOT EXISTS drug_summary_key_trgm_idx          ON public.drug_summary USING gin (key gin_trgm_ops);
CREATE INDEX IF NOT EXISTS drug_summary_pill_count_idx        ON public.drug_summary (pill_count DESC);

UPDATE public.drug_summary_state SET stale = false, refreshed_at = now() WHERE id;
