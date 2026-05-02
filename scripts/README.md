# Scripts

Helper scripts for data maintenance and backfill operations.

## NDC Backfill

See [ADMIN.md](../ADMIN.md) for full NDC backfill documentation.

---

## Drug Indications Backfill (Stage 1)

Fetches FDA "Indications and Usage" text from openFDA for a list of drugs and
stores them in the `drug_indications` table.

### One-time setup

1. Run the migration:
   ```bash
   psql $DATABASE_URL -f supabase/migrations/20260501_drug_indications.sql
   ```
2. Ensure `DATABASE_URL` is set in your environment (same one used by `database.py`).

### Run

```bash
# Fetch the default 10 seed drugs
python scripts/backfill_drug_indications.py

# Just one drug
python scripts/backfill_drug_indications.py --drug ibuprofen

# Dry run (no DB writes)
python scripts/backfill_drug_indications.py --dry-run

# Force refresh (still skips manual overrides)
python scripts/backfill_drug_indications.py --force

# Limit to first 3 drugs in the seed file
python scripts/backfill_drug_indications.py --limit 3
```

### Sample dry-run output

```
✓ ibuprofen — 823 chars (dry-run, not saved)
✓ acetaminophen — 612 chars (dry-run, not saved)
⚠ unknowndrug — not found on openFDA

Processed: 3 | Inserted: 0 | Updated: 0 | Skipped: 0 | Not found: 1 | Errors: 0
```

After a live run, open the Supabase table editor → `drug_indications` and
spot-check the rows to confirm the parsed text looks reasonable.

### Seed file

The default seed list is `scripts/test_drugs.txt` (one drug per line; lines
starting with `#` are treated as comments).  Pass `--seed-file PATH` to use a
different file.

---

## Drug indications — Stage 2 (MedlinePlus, patient-friendly text)

After the openFDA backfill (PR #122), run this to populate `plain_text`
with patient-friendly indication text from NIH MedlinePlus.

### Schema (run once in Supabase SQL Editor)
File: `supabase/migrations/20260501_drug_indications_medlineplus_columns.sql`

### Run backfill (Render Web Shell)
```bash
# Test on 5 rxcuis first
python scripts/backfill_indications_medlineplus.py --limit 5 --dry-run

# Live run, full catalog (~3200 rxcuis, ~10 min)
python scripts/backfill_indications_medlineplus.py

# Re-run later to catch new rxcuis (skips already-fetched)
python scripts/backfill_indications_medlineplus.py
```

### Sample dry-run output (from audit, 5 known rxcuis)

```
✓ 5640 Ibuprofen — 1203 chars (dry-run, not saved)
✓ 29046 Lisinopril — 1456 chars (dry-run, not saved)
✓ 6809 Metformin — 1312 chars (dry-run, not saved)
✓ 723 Amoxicillin — 1189 chars (dry-run, not saved)
⚠ 36437 — no MedlinePlus entry

Processed: 5 | Inserted: 0 | Updated: 0 | Skipped manual: 0 | Not found: 1 | Errors: 0
```

### What it does
- Reads distinct `rxcui` values from `pillfinder` (read-only).
- For each, calls MedlinePlus Connect API (free, no key, NIH/NLM).
- Upserts into `drug_indications` keyed by `rxcui` (one row per RxCUI / per strength).
- **Skips rows with `source='manual'`** (admin edits are protected).
- Expected coverage: ~90% (audited on real data).

### Schema
- `drug_name_key` is no longer UNIQUE (was obsoleted by per-rxcui rows). Migration: `20260501_drug_indications_drop_drug_name_key_unique.sql`.

### Idempotent
Re-running only fetches rxcuis not already in `drug_indications`. Use `--force`
to refresh existing MedlinePlus rows (manual edits still skipped).

### Migration note
The migration (`20260501_drug_indications_medlineplus_columns.sql`) was already
run by the user directly in Supabase SQL Editor. After merge, run:
```bash
python scripts/backfill_indications_medlineplus.py --limit 10 --dry-run
```
then proceed with the full live run once the dry-run output looks correct.
