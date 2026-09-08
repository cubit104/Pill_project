-- Refill tracking for the medicine cabinet (app + website).
--
-- The user tells us how many pills they have and (optionally) how many they
-- take per day; the clients compute days-left from the reminder schedule and
-- warn `refill_notify_days` before the supply runs out. Nothing here needs a
-- backend job: the arithmetic lives in the app/site, and the table already has
-- row-level security + grants for the authenticated role (table-level grants
-- cover new columns).
ALTER TABLE public.cabinet_items
    ADD COLUMN IF NOT EXISTS pills_on_hand      integer,        -- count at pills_counted_at
    ADD COLUMN IF NOT EXISTS pills_counted_at   timestamptz,    -- when the count was entered
    ADD COLUMN IF NOT EXISTS pills_per_day      numeric(6, 2),  -- manual rate; NULL = derive from the reminder
    ADD COLUMN IF NOT EXISTS fill_quantity      integer,        -- pills per refill ("I refilled" resets to this)
    ADD COLUMN IF NOT EXISTS refill_notify_days integer NOT NULL DEFAULT 5;

ALTER TABLE public.cabinet_items DROP CONSTRAINT IF EXISTS cabinet_items_pills_on_hand_check;
ALTER TABLE public.cabinet_items ADD CONSTRAINT cabinet_items_pills_on_hand_check
    CHECK (pills_on_hand IS NULL OR pills_on_hand BETWEEN 0 AND 10000);
ALTER TABLE public.cabinet_items DROP CONSTRAINT IF EXISTS cabinet_items_pills_per_day_check;
ALTER TABLE public.cabinet_items ADD CONSTRAINT cabinet_items_pills_per_day_check
    CHECK (pills_per_day IS NULL OR (pills_per_day > 0 AND pills_per_day <= 100));
ALTER TABLE public.cabinet_items DROP CONSTRAINT IF EXISTS cabinet_items_fill_quantity_check;
ALTER TABLE public.cabinet_items ADD CONSTRAINT cabinet_items_fill_quantity_check
    CHECK (fill_quantity IS NULL OR fill_quantity BETWEEN 1 AND 10000);
ALTER TABLE public.cabinet_items DROP CONSTRAINT IF EXISTS cabinet_items_refill_notify_days_check;
ALTER TABLE public.cabinet_items ADD CONSTRAINT cabinet_items_refill_notify_days_check
    CHECK (refill_notify_days BETWEEN 0 AND 60);
