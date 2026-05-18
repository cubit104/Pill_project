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

## Legal / user-facing disclaimers

Every response and UI card includes disclaimers:

1. NADAC reflects pharmacy acquisition cost, not your out-of-pocket cost.
2. Actual prices vary by pharmacy, insurance, and location.
3. This is not medical advice. Always consult your pharmacist.

These estimates are informational benchmarks, not guaranteed patient pricing.
