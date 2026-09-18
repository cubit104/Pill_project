-- Second imprint reader (services/ai_reader.py): what it read, how sure it was,
-- what the call cost, and which reader produced the exact match the user saw.
-- All nullable: rows written before this, or with the feature off, keep NULLs.
ALTER TABLE public.identify_feedback
    ADD COLUMN IF NOT EXISTS ai_read text,
    ADD COLUMN IF NOT EXISTS ai_confidence text,
    ADD COLUMN IF NOT EXISTS ai_cost_micros integer,   -- millionths of a US dollar for this one call
    ADD COLUMN IF NOT EXISTS read_source text;         -- 'reader' | 'ai' | 'none'

ALTER TABLE public.identify_feedback
    DROP CONSTRAINT IF EXISTS identify_feedback_read_source_check;
ALTER TABLE public.identify_feedback
    ADD CONSTRAINT identify_feedback_read_source_check
    CHECK (read_source IS NULL OR read_source IN ('reader', 'ai', 'none'));
