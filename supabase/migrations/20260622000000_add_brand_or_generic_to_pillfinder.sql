ALTER TABLE public.pillfinder
    ADD COLUMN IF NOT EXISTS brand_or_generic TEXT
    CHECK (brand_or_generic IN ('brand', 'generic'))
    DEFAULT NULL;
