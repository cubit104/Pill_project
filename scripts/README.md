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

---

## Condition Tags Backfill

Populates the `drug_condition_tags` table by running keyword matching against
`drug_indications.plain_text`.  This powers the **"Other medications used for
the same condition"** section on public pill detail pages.

### Schema (run once in Supabase SQL Editor)
File: `supabase/migrations/20260503_drug_condition_tags.sql`

### Run backfill (Render Web Shell)
```bash
# Preview tags without writing to DB
python scripts/backfill_condition_tags.py --dry-run

# Live run — idempotent, safe to re-run
python scripts/backfill_condition_tags.py
```

### Sample dry-run output
```
✓ 749198 clopidogrel — ['blood clot', 'heart attack', 'stroke'] (dry-run, not saved)
✓ 5640 ibuprofen — ['pain', 'arthritis'] (dry-run, not saved)
⚠ 99999 someDrug — no tags matched

Processed: 3 | Tagged: 2 | No-match: 1 | Skipped (dup rxcui): 0
```

### What it does
- Joins `drug_indications` (for `plain_text`) with `pillfinder` (for `rxcui` / `medicine_name`).
- Runs word-boundary keyword matching (~30 medical conditions defined in `services/condition_tags.py`).
- For each rxcui, **removes stale tags** that no longer match the current `plain_text`, then inserts new ones.
- Processes each `rxcui` only once (multiple strength rows sharing the same RxCUI are deduplicated).

### Idempotent / self-healing
Re-running is safe and recommended whenever `drug_indications.plain_text` is updated.  Stale
tags from a previous run are automatically deleted; new tags are added with `ON CONFLICT DO NOTHING`.

---

## RxCUI Backfill

Backfills missing `rxcui` values on the `pillfinder` table using
**openFDA** (brand/generic name + strength search) and the **free RxNorm
properties API** (no API key needed).  Handles ~1,711 rows that have
`rxcui IS NULL` but a valid `ndc9` or `ndc11`.

> **Why not NDC-based RxNorm lookup?**
> These are old/discontinued drugs whose NDCs are no longer in the active
> registry.  `rxcui.json?idtype=NDC&id=…` returns `{"idGroup":{}}` for all
> of them.  The name + strength approach works reliably instead.

### What it does
1. Selects rows from `pillfinder` where `rxcui IS NULL` and a valid NDC exists.
2. Searches **openFDA** by `brand_name` + `active_ingredients.strength`.
   Fallback chain if NOT_FOUND:
   1. Retry brand_name without strength
   2. Try `generic_name` + strength
   3. Try `generic_name` without strength
3. For each rxcui candidate returned by openFDA, calls
   **RxNorm `properties.json`** to inspect `tty` and `name`.
4. Picks the best rxcui using priority:
   - `tty=SCD` AND strength matches `spl_strength` → **HIGH**
   - `tty=SBD` AND strength matches → **HIGH** (or **MEDIUM** if multiple)
   - `tty=SCD` without strength match → **LOW**
   - `tty=SBD` without strength match → **LOW**
   - Only other tty / NOT_FOUND → **SKIPPED** (`outcome=no_match`)
5. Writes only `rxcui` back to `pillfinder`.
   **`ndc11` is never updated** — the original NDC labeler has changed for
   these old drugs; overwriting ndc11 with a different manufacturer's NDC
   would be incorrect.
6. Logs every processed row to `rxcui_backfill_log`.

### Confidence tiers

| Confidence | Condition |
|---|---|
| **HIGH** | openFDA returns results, exactly 1 SCD/SBD rxcui matches strength |
| **MEDIUM** | openFDA returns results, multiple SCD/SBD match, picked best by strength+form |
| **LOW** | openFDA returns results but no strength match, picked SCD/SBD by tty only |
| **SKIPPED** | NOT_FOUND or no SCD/SBD tty found |

Only HIGH and MEDIUM rows are written by default (`--confidence MEDIUM`).

### Schema (run once in Supabase SQL Editor)

The audit log table is created automatically at script startup:

```sql
CREATE TABLE IF NOT EXISTS rxcui_backfill_log (
  id SERIAL PRIMARY KEY,
  pill_id UUID NOT NULL,
  medicine_name TEXT,
  old_rxcui TEXT,
  new_rxcui TEXT,
  old_ndc11 TEXT,
  new_ndc11 TEXT,
  padded_ndc9 TEXT,
  confidence TEXT,  -- HIGH / MEDIUM / LOW / SKIPPED / ERROR
  outcome TEXT,     -- written / skipped_confidence / skipped_discontinued / skipped_no_ndc / no_match / api_error / dry_run
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Step-by-step usage (Render Web Shell)

```bash
# Step 1 — Always dry-run first, review output before writing anything
python scripts/backfill_rxcui_and_ndc11.py --dry-run --limit 10

# Step 2 — Run in batches of 200 (default 300ms sleep between rows)
python scripts/backfill_rxcui_and_ndc11.py --limit 200 --sleep-ms 300

# Step 3 — Continue until done (~1,711 rows)
python scripts/backfill_rxcui_and_ndc11.py --limit 200 --offset 200 --sleep-ms 300
python scripts/backfill_rxcui_and_ndc11.py --limit 200 --offset 400 --sleep-ms 300
# ... etc.

# Only write HIGH-confidence rows (most conservative)
python scripts/backfill_rxcui_and_ndc11.py --limit 200 --confidence HIGH

# Skip likely-discontinued drugs (< 6 significant ndc9 digits)
python scripts/backfill_rxcui_and_ndc11.py --limit 200 --skip-discontinued
```

### Sample dry-run output

```json
{"pill_id": "624b575e-...", "medicine_name": "SINGULAIR", "padded_ndc9": "000060117", "rxcui": "200224", "confidence": "HIGH", "outcome": "dry_run"}
{"pill_id": "057af4a0-...", "medicine_name": "Reprexain", "padded_ndc9": "637170901", "rxcui": null, "confidence": "SKIPPED", "outcome": "no_match"}
{"processed": 10, "written": 0, "skipped_confidence": 0, "no_match": 1, "api_error": 0, "dry_run": true}
```

### Reading the audit log

```sql
-- See all changes from the most recent run
SELECT pill_id, medicine_name, old_rxcui, new_rxcui,
       padded_ndc9, confidence, outcome, notes, created_at
FROM rxcui_backfill_log
ORDER BY created_at DESC
LIMIT 50;

-- Count outcomes from last run
SELECT outcome, confidence, COUNT(*) AS n
FROM rxcui_backfill_log
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY outcome, confidence
ORDER BY n DESC;

-- Find all low-confidence rows needing manual review
SELECT * FROM rxcui_backfill_log
WHERE confidence = 'LOW'
ORDER BY created_at DESC;
```

### How to roll back if needed

```sql
-- Roll back all changes from a specific run (replace the timestamp with the
-- start time of the run you want to undo, e.g. '2026-05-04 12:00:00')
UPDATE pillfinder p
SET rxcui = l.old_rxcui
FROM rxcui_backfill_log l
WHERE p.id = l.pill_id
  AND l.outcome = 'written'
  AND l.created_at > '<YYYY-MM-DD HH:MM:SS>';
```
