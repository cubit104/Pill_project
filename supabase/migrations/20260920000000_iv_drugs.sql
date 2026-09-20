-- IV drugs: one row per drug (ingredient), not per product.
--
-- FDA lists ~6,900 intravenous prescription products; they collapse to ~500 drugs.
-- Each row keeps the ONE DailyMed label (spl_set_id) chosen for the drug. The label
-- text itself is NOT stored here: it goes through the same medication_guide cache the
-- pill pages use, looked up by spl_set_id. This table adds what a label does not give
-- in one place: all brands, all strengths from all makers, and the IV administration
-- card (facts quoted from the label, approved by a reviewer before anyone sees them).
--
-- Rows are written by scripts/import_iv_drugs.py and arrive unpublished.
CREATE TABLE IF NOT EXISTS public.iv_drugs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                text NOT NULL,                       -- /iv/<slug>
    ingredient_key      text NOT NULL,                       -- RxNorm ingredient rxcuis, sorted, joined with '+'
    rxcuis              text[] NOT NULL DEFAULT '{}',        -- the same ingredient rxcuis, for matching pills and synonyms
    generic_name        text NOT NULL,
    brand_names         text[] NOT NULL DEFAULT '{}',
    drug_class          text[] NOT NULL DEFAULT '{}',
    routes              text[] NOT NULL DEFAULT '{}',
    dea_schedule        text,

    -- the one label chosen for this drug
    spl_set_id          text NOT NULL,
    other_setids        text[] NOT NULL DEFAULT '{}',        -- next best labels, so a reviewer can switch
    setid_locked        boolean NOT NULL DEFAULT false,      -- true = picked by hand, the importer must not change it
    label_type          text CHECK (label_type IN ('brand', 'nda', 'authorized_generic', 'generic', 'unapproved')),
    label_brand         text,
    label_maker         text,
    label_presentation  text,                                -- what the label covers, e.g. 'vial' or 'premixed bag'
    application_number  text,
    label_version       integer,
    label_date          date,

    -- every strength from every maker: [{"strength": "...", "form": "...", "makers": 12}]
    strengths           jsonb NOT NULL DEFAULT '[]'::jsonb,
    product_count       integer NOT NULL DEFAULT 0,
    maker_count         integer NOT NULL DEFAULT 0,

    -- IV administration card. The public API returns it only when card_status = 'approved'.
    card                jsonb,
    card_status         text NOT NULL DEFAULT 'none' CHECK (card_status IN ('none', 'draft', 'approved', 'rejected')),
    card_label_version  integer,                             -- label version the card was made from
    card_generated_at   timestamptz,
    card_reviewed_by    text,
    card_reviewed_at    timestamptz,
    card_review_notes   text,

    meta_title          text,
    meta_description    text,
    published           boolean NOT NULL DEFAULT false,
    deleted_at          timestamptz,
    source_refreshed_at timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT iv_drugs_slug_key UNIQUE (slug),
    CONSTRAINT iv_drugs_ingredient_key_key UNIQUE (ingredient_key),
    CONSTRAINT iv_drugs_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

CREATE INDEX IF NOT EXISTS iv_drugs_spl_set_id_idx ON public.iv_drugs (spl_set_id);
CREATE INDEX IF NOT EXISTS iv_drugs_rxcuis_idx ON public.iv_drugs USING gin (rxcuis);
-- A to Z pages: live rows by first letter
CREATE INDEX IF NOT EXISTS iv_drugs_name_idx ON public.iv_drugs (lower(generic_name) text_pattern_ops)
    WHERE deleted_at IS NULL AND published;
-- admin review queue
CREATE INDEX IF NOT EXISTS iv_drugs_card_status_idx ON public.iv_drugs (card_status) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS iv_drugs_touch ON public.iv_drugs;
CREATE TRIGGER iv_drugs_touch BEFORE UPDATE ON public.iv_drugs
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Backend only (it connects as postgres). Nothing for the public API roles.
ALTER TABLE public.iv_drugs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.iv_drugs FROM anon, authenticated;

COMMENT ON TABLE public.iv_drugs IS 'IV drugs: one row per ingredient with its chosen DailyMed label, strengths and reviewed administration card.';
