-- ============================================================================
-- pill_price_snapshot
-- ----------------------------------------------------------------------------
-- Pre-resolved price + 52-week history + alternatives for every published pill.
-- Populated weekly by scripts/refresh_pill_price_snapshots.py (after NADAC sync).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.pill_price_snapshot (
  slug                    text PRIMARY KEY,
  pill_id                 uuid,
  resolved_ndc11          text,
  match_type              text NOT NULL DEFAULT 'none'
                          CHECK (match_type IN ('exact','equivalent','approximate','none')),
  resolved_via            text
                          CHECK (resolved_via IN ('self','sibling','rxcui','name') OR resolved_via IS NULL),
  price_per_unit          numeric(12, 6),
  unit                    text,
  effective_date          date,
  total_acquisition_cost  numeric(12, 4),
  fair_retail_low         numeric(12, 4),
  fair_retail_high        numeric(12, 4),
  history_52w             jsonb DEFAULT '[]'::jsonb,
  history_source_ndc      text,
  alternatives            jsonb DEFAULT '[]'::jsonb,
  is_estimate             boolean NOT NULL DEFAULT false,
  estimate_basis          text,
  display_disclaimer      text,
  schema_offers_valid     boolean GENERATED ALWAYS AS (
    price_per_unit   IS NOT NULL
    AND fair_retail_low  IS NOT NULL
    AND fair_retail_high IS NOT NULL
  ) STORED,
  resolved_at             timestamptz NOT NULL DEFAULT now(),
  resolver_version        int NOT NULL DEFAULT 1,
  resolver_notes          text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_snapshot_resolved_at
  ON public.pill_price_snapshot (resolved_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshot_match_type
  ON public.pill_price_snapshot (match_type);
CREATE INDEX IF NOT EXISTS idx_snapshot_schema_valid
  ON public.pill_price_snapshot (schema_offers_valid)
  WHERE schema_offers_valid = false;
CREATE INDEX IF NOT EXISTS idx_snapshot_pill_id
  ON public.pill_price_snapshot (pill_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_resolved_ndc11
  ON public.pill_price_snapshot (resolved_ndc11)
  WHERE resolved_ndc11 IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tg_pill_price_snapshot_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_pill_price_snapshot_updated_at ON public.pill_price_snapshot;
CREATE TRIGGER trg_pill_price_snapshot_updated_at
  BEFORE UPDATE ON public.pill_price_snapshot
  FOR EACH ROW EXECUTE FUNCTION public.tg_pill_price_snapshot_set_updated_at();

ALTER TABLE public.pill_price_snapshot ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pill_price_snapshot_public_read ON public.pill_price_snapshot;
CREATE POLICY pill_price_snapshot_public_read
  ON public.pill_price_snapshot FOR SELECT USING (auth.role() = 'authenticated');

CREATE OR REPLACE VIEW public.v_snapshots_needing_attention AS
SELECT slug, pill_id, match_type, resolved_via, is_estimate, resolver_notes, resolved_at
FROM public.pill_price_snapshot
WHERE schema_offers_valid = false OR match_type = 'none'
ORDER BY resolved_at DESC;

COMMENT ON TABLE public.pill_price_snapshot IS
  'Pre-resolved price + history + alternatives per pill. Populated weekly by the snapshot resolver cron after NADAC refresh. Replaces the runtime NDC-resolution waterfall.';
