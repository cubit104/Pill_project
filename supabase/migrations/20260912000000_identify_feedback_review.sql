-- Editorial review of camera captures (Admin -> Photo Captures).
--
-- side_labels: what a reviewer can actually read on EACH stored photo, in
-- photo_paths order ("" = nothing readable on that side). The reader is
-- trained per image, so a two-sided capture needs two labels; reviewed_label
-- stays the whole pill's imprint (what the text matcher and catalog use).
ALTER TABLE public.identify_feedback
    ADD COLUMN IF NOT EXISTS side_labels jsonb,
    ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
    ADD COLUMN IF NOT EXISTS reviewed_by text;

-- The review queue: unreviewed captures that actually carry photos.
CREATE INDEX IF NOT EXISTS identify_feedback_review_queue_idx
    ON public.identify_feedback (created_at DESC)
    WHERE reviewed = false AND photo_paths IS NOT NULL;
