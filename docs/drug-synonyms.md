# Drug synonyms integration

This project uses two RxNorm-backed tables for synonym resolution:

- `drug_synonyms`: ingredient-level row (`ingredient_rxcui`) with `generic_name` and `brand_names[]`
- `rxcui_to_ingredient`: product-level RxCUI (`product_rxcui`) mapped to ingredient RxCUI + product TTY

## Feature flag (search + autocomplete)

Search/autocomplete synonym expansion is feature-flagged and defaults OFF.

Set on Render:

```bash
USE_DRUG_SYNONYMS=true
```

When unset/false, search behavior stays on the existing medicine-name/imprint/NDC logic.

## Admin auto-resolve hook (always on)

Admin create/update/bulk pill writes now run a best-effort synonym resolver when `rxcui` is present:

- idempotent check against `rxcui_to_ingredient`
- short-timeout RxNorm lookup
- insert with `ON CONFLICT DO NOTHING`
- wrapped in `try/except` so pill saves cannot fail due to RxNorm issues

## Periodic refresh

To refresh existing mappings from RxNorm:

```bash
python scripts/backfill_drug_synonyms.py --refresh-existing --sleep-ms 100
```

## Pill detail API fields

`/api/pill/{slug}` now includes additive synonym fields:

- `generic_name`
- `brand_names_all`
- `is_brand_row`
