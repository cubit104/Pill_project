# Scripts

Helper scripts for data maintenance and backfill operations.

## NDC Backfill

See [ADMIN.md](../ADMIN.md) for full NDC backfill documentation.

---

## Drug Indications Backfill (Stage 1.5)

Fetches FDA "Indications and Usage" text from openFDA for a list of drugs,
resolved via RxNorm RxCUI to guarantee a pure-ingredient (not combo) label.

### Schema migrations

Run these in Supabase SQL Editor in order:
1. `supabase/migrations/20260501_drug_indications.sql` (PR #1)
2. `supabase/migrations/20260501_drug_indications_add_rxcui.sql` (PR #1.5 — adds rxcui + rxcui_name)

### How resolution works (PR #1.5+)

Drug name → RxNav (find ingredient RxCUI) → openFDA (label by RxCUI).
This guarantees we get the pure-ingredient label, not a combo drug.

```
Drug name (e.g. "lisinopril")
   │
   ▼  RxNav API: rxcui.json?name=lisinopril&search=2
INGREDIENT RxCUI (e.g. 29046 = "lisinopril" pure ingredient)
   │
   ▼  openFDA: search=openfda.rxcui:"29046"
Correct FDA label (pure lisinopril, not combo) ✅
```

### One-time setup

1. Run migration 1 (creates table):
   ```sql
   -- paste contents of supabase/migrations/20260501_drug_indications.sql
   ```
2. Run migration 2 (adds rxcui columns):
   ```sql
   -- paste contents of supabase/migrations/20260501_drug_indications_add_rxcui.sql
   ```
3. Ensure `DATABASE_URL` is set in your environment.

### Run

```bash
# Fetch the default 10 seed drugs (RxCUI chain)
python scripts/backfill_drug_indications.py

# Just one drug
python scripts/backfill_drug_indications.py --drug lisinopril

# Dry run (no DB writes)
python scripts/backfill_drug_indications.py --dry-run

# Force refresh all rows (still skips manual overrides)
python scripts/backfill_drug_indications.py --force

# Limit to first 3 drugs in the seed file
python scripts/backfill_drug_indications.py --limit 3
```

### Sample dry-run output

```
✓ lisinopril → rxcui 29046 — 478 chars (dry-run, not saved)
✓ metformin → rxcui 6809 — 312 chars (dry-run, not saved)
✓ amoxicillin → rxcui 723 — 891 chars (dry-run, not saved)
⚠ unknowndrug — could not resolve RxCUI or no FDA label found

Processed: 4 | Inserted: 0 | Updated: 0 | Skipped: 0 | Not found: 1 | Errors: 0
```

After merge, run the new migration in Supabase SQL Editor, then
`python scripts/backfill_drug_indications.py --force` in Render Web Shell.

### Seed file

The default seed list is `scripts/test_drugs.txt` (one drug per line; lines
starting with `#` are treated as comments).  Pass `--seed-file PATH` to use a
different file.
