# Pricing: NADAC Pharmacy Cost Benchmark

## Why NADAC

PillSeek uses **NADAC (National Average Drug Acquisition Cost)** from CMS/data.medicaid.gov as a transparent benchmark for what pharmacies pay to acquire medication inventory.

This is intentionally **not** a GoodRx clone:

- GoodRx data/API is commercial and partnership-gated.
- NADAC is free, official, and updated weekly.
- NADAC is NDC-keyed, which aligns with this repository's existing NDC normalization and lookup pipeline.

Reference: https://data.medicaid.gov/dataset?theme=Pharmacy

## Resolution chain

Pricing resolution now follows a 4-tier fallback chain:

| Tier | Endpoint | Behavior |
|---|---|---|
| 1 | `GET /api/prices/{ndc}` | Exact NADAC match by requested NDC |
| 2 | `GET /api/prices/{ndc}` | Equivalent-NDC fallback (same RxCUI family) when exact NDC is missing |
| 3 | `GET /api/prices/by-rxcui/{rxcui}` | Resolve sibling NDCs from RxCUI, bulk-query NADAC, return cheapest |
| 4 | `GET /api/prices/by-name/{name}` | Resolve name → ingredient RxCUI via RxNav, then use by-rxcui resolution |

If all tiers fail, the frontend hides the Pharmacy Cost Benchmark card.

## What the feature returns

For each NDC, API responses include:

- `price_per_unit`
- `unit` (`EA`, `ML`, `GM`)
- `effective_date`
- `source` (`NADAC (CMS)`)
- `as_of_week`
- computed totals and fair retail estimate for supply inputs

When exact NADAC data exists for the requested NDC, `match_type` is omitted (equivalent to `"exact"`).
When fallback pricing is used, the response may include:

- `match_type` (`equivalent` or `approximate`)
- `matched_ndc` (the sibling NDC that had NADAC data)
- `source_rxcui` (RxCUI used for sibling resolution)
- `resolved_ingredient` (ingredient chosen from name-based lookup)
- `resolved_rxcui` (ingredient RxCUI from name-based lookup)
- `equivalent_count` (number of sibling NDCs considered)

Fair retail estimate methodology (benchmark only):

- acquisition total = `price_per_unit * units_per_day * days_supply`
- `fair_retail_low = acquisition_total * 1.5`
- `fair_retail_high = acquisition_total * 3.0`

Default assumptions: `units_per_day=1`, `days_supply=30`.

## Data update cadence

- NADAC files are published weekly (typically Wednesday).
- `scripts/refresh_nadac.py` bulk upserts latest records into:
  - `drug_prices` (current read-through cache)
  - `drug_price_history` (weekly history points)
- GitHub Action `refresh-nadac.yml` schedules refresh at `0 14 * * 3` (Wednesday, 14:00 UTC).

## Pre-resolved snapshots

The `/pill/{slug}/price` page now prefers a pre-resolved row from `pill_price_snapshot` before it falls back to the runtime pricing waterfall.

Each snapshot stores:

- the resolved NDC and match strategy
- the current benchmark price and fair-retail range
- cached `history_52w`
- cached alternatives
- schema safety fields such as `schema_offers_valid`

This moves the slow NDC resolution path out of SSR and into an offline refresh step.

### Refresh cadence

- `refresh-nadac.yml` runs first to sync the latest NADAC data.
- `refresh-snapshots.yml` then runs automatically on successful completion of that workflow using `--force --all --concurrency 20` so existing prices are refreshed weekly.
- Editors can also trigger the snapshot workflow manually with `workflow_dispatch`.

### Local backfill / refresh

Run the safe default refresh (all missing snapshots):

```bash
make refresh-snapshots
```

Useful one-off commands:

```bash
python -m scripts.refresh_pill_price_snapshots --dry-run --limit 10
python -m scripts.refresh_pill_price_snapshots --slug Wegovy-9-mg
python -m scripts.refresh_pill_price_snapshots --force --all --concurrency 20
```

Each processed pill prints a JSON line with the slug, match type, resolver tier, and resolved unit price.

### Debugging a single pill

1. Resolve one slug locally with:

   ```bash
   python -m scripts.refresh_pill_price_snapshots --slug <slug> --dry-run
   ```

2. Inspect the public snapshot row:

   ```bash
   GET /api/snapshot/{slug}
   ```

3. Review unresolved rows in:

   ```sql
   SELECT * FROM public.v_snapshots_needing_attention;
   ```

If no snapshot row exists yet, the frontend still falls back to the live pricing waterfall so rollout is safe while the table is being backfilled.

## History Backfill

`refresh_nadac.py` only writes the current NADAC week. Without a one-time history load, `drug_price_history` stays sparse (often 0-2 points per NDC) until enough weekly runs accumulate.

Run the backfill once with:

```bash
make backfill-nadac-history
```

Or trigger it from admin:

- `POST /api/admin/backfill/nadac-history/run`

The backfill queries up to the last 52 weekly NADAC datasets, filters to NDCs present in `pillfinder`, and inserts into `drug_price_history`.

It is idempotent and safe to rerun (`ON CONFLICT DO NOTHING` on `(ndc, effective_date)`).

Operational expectations:

- Runtime: ~30-60 minutes for the full pillfinder NDC set
- Storage growth: ~25-100MB depending on how many NDCs match NADAC rows

## Schema discovery

NADAC datastore schemas can drift (column names may change between distributions). The pricing service now auto-discovers columns by querying the latest distribution with `limit=1` and inspecting row keys.

Resolved columns are cached per distribution and used for:

- NDC filter column
- effective-date sort/filter column
- price column
- unit column

If discovery fails, the service falls back to the legacy hardcoded candidates and tolerates CMS `400 Column not found` responses by trying the next candidate.

## Equivalent and approximate fallback details

If an exact NDC is not present in the weekly NADAC dataset, pricing falls back to therapeutically equivalent sibling NDCs:

1. Resolve requested `NDC -> RxCUI`
2. Resolve `RxCUI -> sibling NDCs` (same ingredient + strength + dose form)
3. Bulk query NADAC for sibling NDCs
4. Parse valid rows and choose the lowest `price_per_unit`
5. Return price under the original requested NDC with equivalent-match metadata (`match_type`, `matched_ndc`, `equivalent_count`)

For direct RxCUI and name lookups, synthetic cache keys are used (`rxcui:{rxcui}`, `name:{slug}`) and full fallback metadata is preserved in cache payloads.

The cache fast-path now skips NADAC metadata lookups entirely when the cached row is still fresh **and** its `effective_date` is recent enough. Older cache rows still resolve metadata before deciding whether the stale-row fallback chain needs to run, so performance improves without weakening stale-data checks.

## Legal / user-facing disclaimers

Every response and UI card includes disclaimers:

1. NADAC reflects pharmacy acquisition cost, not your out-of-pocket cost.
2. Actual prices vary by pharmacy, insurance, and location.
3. This is not medical advice. Always consult your pharmacist.

These estimates are informational benchmarks, not guaranteed patient pricing.

## Troubleshooting

Start with `GET /api/prices/health`. This endpoint always returns a JSON status report and is the fastest way to isolate whether pricing failures are from database dependencies or upstream APIs.

Checks returned:

- `database`: runs `SELECT 1`. If this fails, verify `DATABASE_URL`, network access, and database availability.
- `drug_prices_table`: runs `SELECT count(*) FROM drug_prices`. If `detail` says relation missing, apply pricing migrations.
- `drug_price_history_table`: runs `SELECT count(*) FROM drug_price_history`. If missing, apply pricing migrations.
- `nadac_catalog`: verifies NADAC catalog metadata lookup (`dataset_id`, `as_of_week`). If failing, confirm outbound access to `data.medicaid.gov`.
  - Includes `columns` and `all_columns` so you can immediately see the resolved schema for the active distribution.
- `rxnav`: verifies RxNav availability via `https://rxnav.nlm.nih.gov/REST/version.json`.

Manual checks for each tier:

- NDC: `GET /api/prices/00002-1401-02`
- RxCUI: `GET /api/prices/by-rxcui/6809`
- Name: `GET /api/prices/by-name/metformin`

If `/api/prices/{ndc}` returns 404 for a known product:

- verify RxNav returns an RxCUI for that NDC (`/REST/ndcstatus.json`)
- verify RxNav returns sibling NDCs for that RxCUI (`/REST/rxcui/{rxcui}/ndcs.json`)
- confirm sibling NDCs contain at least one weekly NADAC row

If `/api/prices/by-rxcui/{rxcui}` returns 404:

- verify the RxCUI exists and has NDC siblings in RxNav
- verify at least one sibling NDC has a parseable NADAC row

If `/api/prices/by-name/{name}` returns 404:

- verify RxNav can resolve the input name to an ingredient RxCUI (`/REST/drugs.json?name=...`)
- verify the resolved ingredient RxCUI can produce sibling NDC pricing through `/api/prices/by-rxcui/{rxcui}`

`overall` status semantics:

- `ok`: database + tables + external APIs are healthy.
- `degraded`: database + tables are healthy, but NADAC or RxNav is failing.
- `down`: database or required pricing tables are failing.

CMS catalog responses can be either a top-level JSON list or an object (`results`/`items`), so the pricing service defensively handles both response shapes.

If NADAC catalog lookup fails intermittently (or parsing fails unexpectedly), set `NADAC_FALLBACK_DATASET_ID` to a known-good NADAC dataset UUID so pricing can continue while catalog metadata is unavailable.

## Startup behavior

Slug regeneration is now gated behind `RUN_SLUG_REGEN_ON_STARTUP=false` by default. Leave it disabled in production and run `python -m scripts.regenerate_slugs` manually when you intentionally need a backfill.

Integration-style external API tests should be run separately with:

```bash
pytest -m integration
```
