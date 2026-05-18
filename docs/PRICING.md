# Pricing: NADAC Pharmacy Cost Benchmark

## Why NADAC

PillSeek uses **NADAC (National Average Drug Acquisition Cost)** from CMS/data.medicaid.gov as a transparent benchmark for what pharmacies pay to acquire medication inventory.

This is intentionally **not** a GoodRx clone:

- GoodRx data/API is commercial and partnership-gated.
- NADAC is free, official, and updated weekly.
- NADAC is NDC-keyed, which aligns with this repository's existing NDC normalization and lookup pipeline.

Reference: https://data.medicaid.gov/dataset?theme=Pharmacy

## What the feature returns

For each NDC, API responses include:

- `price_per_unit`
- `unit` (`EA`, `ML`, `GM`)
- `effective_date`
- `source` (`NADAC (CMS)`)
- `as_of_week`
- computed totals and fair retail estimate for supply inputs

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

## Schema discovery

NADAC datastore schemas can drift (column names may change between distributions). The pricing service now auto-discovers columns by querying the latest distribution with `limit=1` and inspecting row keys.

Resolved columns are cached per distribution and used for:

- NDC filter column
- effective-date sort/filter column
- price column
- unit column

If discovery fails, the service falls back to the legacy hardcoded candidates and tolerates CMS `400 Column not found` responses by trying the next candidate.

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

`overall` status semantics:

- `ok`: database + tables + external APIs are healthy.
- `degraded`: database + tables are healthy, but NADAC or RxNav is failing.
- `down`: database or required pricing tables are failing.

CMS catalog responses can be either a top-level JSON list or an object (`results`/`items`), so the pricing service defensively handles both response shapes.

If NADAC catalog lookup fails intermittently (or parsing fails unexpectedly), set `NADAC_FALLBACK_DATASET_ID` to a known-good NADAC dataset UUID so pricing can continue while catalog metadata is unavailable.
