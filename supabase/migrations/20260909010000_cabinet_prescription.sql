-- Prescription details on a cabinet item (filled by the bottle-label scan or by hand):
-- directions as printed, Rx number, pharmacy, prescriber, refills left.
-- All optional text; RLS + grants on cabinet_items already cover new columns.
ALTER TABLE public.cabinet_items
    ADD COLUMN IF NOT EXISTS directions     text,
    ADD COLUMN IF NOT EXISTS rx_number      text,
    ADD COLUMN IF NOT EXISTS pharmacy_name  text,
    ADD COLUMN IF NOT EXISTS pharmacy_phone text,
    ADD COLUMN IF NOT EXISTS prescriber     text,
    ADD COLUMN IF NOT EXISTS refills_left   integer;

ALTER TABLE public.cabinet_items DROP CONSTRAINT IF EXISTS cabinet_items_prescription_lengths;
ALTER TABLE public.cabinet_items ADD CONSTRAINT cabinet_items_prescription_lengths CHECK (
    (directions     IS NULL OR char_length(directions)     <= 300) AND
    (rx_number      IS NULL OR char_length(rx_number)      <= 40)  AND
    (pharmacy_name  IS NULL OR char_length(pharmacy_name)  <= 120) AND
    (pharmacy_phone IS NULL OR char_length(pharmacy_phone) <= 30)  AND
    (prescriber     IS NULL OR char_length(prescriber)     <= 120) AND
    (refills_left   IS NULL OR refills_left BETWEEN 0 AND 99)
);
