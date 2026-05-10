-- Bust medguide_html cache after rendering pipeline updates
-- (outer-table unwrap, heading promotion, dash-paragraph strip).
-- Idempotent: ADD COLUMN IF NOT EXISTS not needed — column already exists.
UPDATE public.medication_guide SET medguide_html = NULL;
