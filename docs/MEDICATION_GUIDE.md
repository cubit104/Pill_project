# Medication Guide Backend API

This backend feature fetches medication guide sections from openFDA `/drug/label.json`, stores them in `public.medication_guide`, and serves them via REST endpoints.

## Environment variables

- `OPENFDA_API_KEY` (optional): if set, appended to openFDA requests for higher rate limits.
- `RUN_LIVE_OPENFDA_TESTS=1` (optional): enables live integration tests marked with `@pytest.mark.live`.
- `SITE_URL` (optional): public site URL for sitemap and IndexNow submission defaults.
- `INDEXNOW_KEY` (optional): enables `python -m scripts.submit_indexnow` and `--submit-indexnow`.
- `INDEXNOW_KEY_LOCATION` (optional): overrides the default `{SITE_URL}/{INDEXNOW_KEY}.txt` verification URL.

## Cache policy

- Cache table: `public.medication_guide`
- Refresh policy: if row is missing or `fetched_at` is older than 30 days, fetch from openFDA and upsert.
- Admin refresh endpoint bypasses TTL and force-refreshes immediately.

## Endpoints

### `GET /api/drugs/{rxcui}/guide`
Returns the cached or refreshed guide by RxCUI.

### `GET /api/drugs/by-ndc/{ndc}/guide`
Returns the cached or refreshed guide by NDC (normalized using `ndc_normalize.py`).

### `GET /api/drugs/by-setid/{spl_set_id}/guide`
Returns the cached or refreshed guide by exact DailyMed SPL Set ID.

### `GET /api/drugs/search?q={name}&limit=10`
RxNorm approximate term resolver:

```json
{ "results": [ { "rxcui": "1234", "name": "Lipitor 10mg tablet", "score": 95 } ] }
```

### `POST /api/admin/drugs/{rxcui}/guide/refresh`
Force-refreshes a guide row regardless of `fetched_at` age (superuser-protected).

## Backfill

Pre-populate the `medication_guide` table for all published pills.

### CLI

    # Safe dry-run (default limit is 5)
    python -m scripts.backfill_medication_guide --dry-run

    # Live run with 5 pills
    python -m scripts.backfill_medication_guide --limit 5

    # Resume larger runs with offsets
    python -m scripts.backfill_medication_guide --limit 100 --offset 100

    # Focus only on rows still missing professional information
    python -m scripts.backfill_medication_guide --limit 100 --only-missing-professional

    # Full run
    python -m scripts.backfill_medication_guide

    # Force refresh of all rows (ignore 30-day cache)
    python -m scripts.backfill_medication_guide --force

    # After a live run, submit changed complete/partial pages to IndexNow
    python -m scripts.backfill_medication_guide --limit 100 --submit-indexnow

    # Submit a single updated page to IndexNow
    python -m scripts.submit_indexnow --url https://pillseek.com/pill/trazodone-hydrochloride-pliva-434-7

    # Expand URLs from a complete or partial backfill report
    python -m scripts.submit_indexnow --from-backfill-report backfill_reports/complete-20260512T171743Z.csv

Reports are written to `./backfill_reports/`.

### Admin API

    POST /api/admin/medication-guide/backfill?limit=5
    POST /api/admin/medication-guide/backfill?limit=100&offset=100&only_missing_professional=true

Runs in the background. Returns `202 Accepted` immediately. Check server logs and the reports directory.

## openFDA mapping table

| # | DB column | openFDA fields (in order, joined with `\n\n`) |
|---|---|---|
| 1 | `overview` | `description` |
| 2 | `uses` | `indications_and_usage` |
| 3 | `dosage` | `dosage_and_administration`, `dosage_forms_and_strengths` |
| 4 | `how_to_take` | `information_for_patients`, `spl_patient_package_insert`, `instructions_for_use` |
| 5 | `side_effects` | `adverse_reactions` |
| 6 | `warnings` | `boxed_warning`, `warnings_and_cautions`, `warnings` |
| 7 | `interactions` | `drug_interactions` |
| 8 | `contraindications` | `contraindications` |
| 9 | `special_populations` | `pregnancy`, `lactation`, `pediatric_use`, `geriatric_use`, `use_in_specific_populations` |
| 10 | `overdose` | `overdosage` |
| 11 | `storage` | `storage_and_handling`, `how_supplied` |
| 12 | `pharmacology` | `clinical_pharmacology`, `mechanism_of_action`, `pharmacokinetics` |
| 13 | `manufacturer` | Readable join of `openfda.manufacturer_name`, `openfda.product_ndc[0]`, `openfda.spl_id[0]` |

Additional stored fields:

- `has_boxed_warning = true` iff `boxed_warning` exists and is non-empty
- `rxcui = openfda.rxcui[0]`
- `ndc = openfda.product_ndc[0]`
- `spl_set_id = openfda.spl_set_id[0]`
- `generic_name = openfda.generic_name[0]`
- `brand_name = openfda.brand_name[0]`
- `source_url = https://api.fda.gov/drug/label.json?search=spl_set_id:{spl_set_id}` (or rxcui if no set id)
