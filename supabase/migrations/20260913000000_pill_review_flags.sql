-- "What's missing?" on drafts (Admin -> Drafts / pill edit page).
--
-- When a reviewer opens an unpublished pill and leaves without publishing, they
-- tick what is still missing. The row turns amber in the Drafts list with those
-- tags so the team knows what to fix. Publishing the pill clears the row.
CREATE TABLE IF NOT EXISTS public.pill_review_flags (
    pill_id     uuid PRIMARY KEY REFERENCES public.pillfinder(id) ON DELETE CASCADE,
    missing     text[] NOT NULL DEFAULT '{}',   -- any of: images, meds_use, imprint, other
    note        text,
    flagged_by  text,
    flagged_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pill_review_flags DISABLE ROW LEVEL SECURITY;
