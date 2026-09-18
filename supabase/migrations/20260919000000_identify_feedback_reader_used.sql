-- Which of our own models produced the read: 'large' (trusted; it stays silent rather than
-- guess), 'base' (last-resort fill-in that can invent a memorised label), or 'none'.
-- Lets Admin -> Photo Captures show our reader and the second reader side by side.
ALTER TABLE public.identify_feedback
    ADD COLUMN IF NOT EXISTS reader_used text;

ALTER TABLE public.identify_feedback
    DROP CONSTRAINT IF EXISTS identify_feedback_reader_used_check;
ALTER TABLE public.identify_feedback
    ADD CONSTRAINT identify_feedback_reader_used_check
    CHECK (reader_used IS NULL OR reader_used IN ('large', 'base', 'none'));
