-- Find a doctor: a cached map position is only reused for the exact address it
-- was geocoded from (hash of address+city+state+zip), so the public geocode
-- endpoint cannot plant coordinates for a real provider's registry address.
ALTER TABLE provider_cache ADD COLUMN IF NOT EXISTS addr_hash text;
