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
