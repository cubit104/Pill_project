from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

import httpx
import kagglehub
from kagglehub import KaggleDatasetAdapter
from sqlalchemy import text

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import database  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("import_kaggle_interactions")

DATASET_HANDLE = "mghobashy/drug-drug-interactions"
_RXNORM_URL = "https://rxnav.nlm.nih.gov/REST/rxcui.json"
BATCH_SIZE = 100
_INSERT_INTERACTION_SQL = """
    INSERT INTO drug_interactions
        (rxcui_1, rxcui_2, drug_name_1, drug_name_2, description, severity, confidence, source_kaggle, source_openfda, updated_at)
    VALUES
        (:r1, :r2, :n1, :n2, :description, :severity, 'medium', TRUE, FALSE, NOW())
    ON CONFLICT (rxcui_1, rxcui_2) DO UPDATE
    SET source_kaggle = TRUE,
        description = CASE
            WHEN drug_interactions.description IS NULL OR drug_interactions.description = ''
            THEN EXCLUDED.description
            ELSE drug_interactions.description
        END,
        severity = CASE
            WHEN drug_interactions.severity IS NULL OR drug_interactions.severity = 'unknown'
            THEN EXCLUDED.severity
            ELSE drug_interactions.severity
        END,
        confidence = CASE
            WHEN drug_interactions.source_openfda THEN 'high'
            ELSE 'medium'
        END,
        updated_at = NOW()
"""


def classify_severity(text_value: str) -> str:
    text_value = (text_value or "").lower()
    if any(w in text_value for w in ["contraindicated", "do not use", "life-threatening", "fatal", "serious risk", "avoid combination"]):
        return "major"
    elif any(w in text_value for w in ["avoid", "serious", "significant", "monitor closely", "caution", "reduce dose", "closely monitor"]):
        return "moderate"
    elif any(w in text_value for w in ["minor", "minimal", "slight", "unlikely"]):
        return "minor"
    return "unknown"


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import Kaggle DDI pairs into drug_interactions")
    parser.add_argument("--dry-run", action="store_true", default=False)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--offset", type=int, default=0)
    return parser.parse_args(argv)


def _ensure_kaggle_auth() -> None:
    token = os.getenv("KAGGLE_API_TOKEN", "").strip()
    username = os.getenv("KAGGLE_USERNAME", "").strip()
    key = os.getenv("KAGGLE_KEY", "").strip()
    if token:
        os.environ["KAGGLE_API_TOKEN"] = token
        return
    if username and key:
        os.environ["KAGGLE_USERNAME"] = username
        os.environ["KAGGLE_KEY"] = key
        return
    raise RuntimeError("Set KAGGLE_API_TOKEN or KAGGLE_USERNAME+KAGGLE_KEY before running import.")


def _pick_column(columns: list[str], choices: list[str]) -> str:
    lookup = {c.lower().strip(): c for c in columns}
    for choice in choices:
        if choice.lower() in lookup:
            return lookup[choice.lower()]
    for col in columns:
        lc = col.lower()
        if any(choice.lower() in lc for choice in choices):
            return col
    raise RuntimeError(f"Unable to find required column among: {columns}")


def _load_dataset_df():
    import pandas as pd

    dataset_dir = Path(kagglehub.dataset_download(DATASET_HANDLE))
    csv_files = sorted(dataset_dir.rglob("*.csv"))
    if not csv_files:
        raise RuntimeError(f"No CSV files found in dataset cache: {dataset_dir}")
    csv_path = csv_files[0]
    relative_path = csv_path.relative_to(dataset_dir).as_posix()
    try:
        return kagglehub.dataset_load(KaggleDatasetAdapter.PANDAS, DATASET_HANDLE, relative_path)
    except Exception:
        return pd.read_csv(csv_path)


def _resolve_rxcui(conn, client: httpx.Client, drug_name: str, cache: dict[str, str | None]) -> str | None:
    cleaned = (drug_name or "").strip()
    if not cleaned:
        return None
    cache_key = cleaned.lower()
    if cache_key in cache:
        return cache[cache_key]

    row = conn.execute(
        text(
            """
            SELECT ingredient_rxcui
            FROM drug_synonyms
            WHERE LOWER(generic_name) = LOWER(:name)
               OR EXISTS (
                    SELECT 1
                    FROM unnest(brand_names) AS bn
                    WHERE LOWER(bn) = LOWER(:name)
               )
            LIMIT 1
            """
        ),
        {"name": cleaned},
    ).fetchone()
    if row and row[0]:
        resolved = str(row[0]).strip()
        cache[cache_key] = resolved
        return resolved

    try:
        response = client.get(_RXNORM_URL, params={"name": cleaned, "allsrc": 0}, timeout=10)
        if response.status_code != 200:
            cache[cache_key] = None
            return None
        rxnorm_ids = (((response.json() or {}).get("idGroup") or {}).get("rxnormId") or [])
        if rxnorm_ids:
            resolved = str(rxnorm_ids[0]).strip()
            cache[cache_key] = resolved
            return resolved
    except Exception as exc:
        logger.warning("RxNorm lookup failed for %s: %s", cleaned, exc)
    cache[cache_key] = None
    return None


def _canonical_pair(rxcui_1: str, rxcui_2: str, name_1: str, name_2: str) -> tuple[str, str, str, str]:
    if rxcui_1 <= rxcui_2:
        return rxcui_1, rxcui_2, name_1, name_2
    return rxcui_2, rxcui_1, name_2, name_1


def _flush_batch(engine, batch: list[dict[str, str]], dry_run: bool) -> int:
    if not batch or dry_run:
        return len(batch)
    with engine.begin() as conn:
        for params in batch:
            conn.execute(text(_INSERT_INTERACTION_SQL), params)
    return len(batch)


def main(argv: list[str] | None = None) -> None:
    args = _parse_args(argv)
    _ensure_kaggle_auth()

    if not database.db_engine and not database.connect_to_database():
        raise RuntimeError("Database connection not available")

    df = _load_dataset_df()
    columns = list(df.columns)
    drug1_col = _pick_column(columns, ["drug1", "drug_1", "drug 1"])
    drug2_col = _pick_column(columns, ["drug2", "drug_2", "drug 2"])
    desc_col = _pick_column(columns, ["interaction", "description", "interaction description"])

    if args.offset:
        df = df.iloc[args.offset :]
    if args.limit and args.limit > 0:
        df = df.iloc[: args.limit]

    inserted = 0
    skipped_no_rxcui = 0
    errors = 0
    total_processed = 0
    batch: list[dict[str, str]] = []
    rxcui_cache: dict[str, str | None] = {}

    with database.db_engine.connect() as conn:
        with httpx.Client(timeout=10) as client:
            for _, row in df.iterrows():
                total_processed += 1
                try:
                    drug1 = str(row.get(drug1_col) or "").strip()
                    drug2 = str(row.get(drug2_col) or "").strip()
                    description = str(row.get(desc_col) or "").strip() or "Interaction noted in Kaggle dataset."
                    if not drug1 or not drug2:
                        skipped_no_rxcui += 1
                        continue

                    rxcui1 = _resolve_rxcui(conn, client, drug1, rxcui_cache)
                    rxcui2 = _resolve_rxcui(conn, client, drug2, rxcui_cache)
                    if not rxcui1 or not rxcui2 or rxcui1 == rxcui2:
                        skipped_no_rxcui += 1
                        continue

                    r1, r2, n1, n2 = _canonical_pair(rxcui1, rxcui2, drug1, drug2)
                    severity = classify_severity(description)
                    if not args.dry_run:
                        batch.append(
                            {
                                "r1": r1,
                                "r2": r2,
                                "n1": n1,
                                "n2": n2,
                                "description": description,
                                "severity": severity,
                            }
                        )
                        if len(batch) >= BATCH_SIZE:
                            inserted += _flush_batch(database.db_engine, batch, args.dry_run)
                            batch.clear()
                except Exception as exc:
                    errors += 1
                    logger.warning("Failed to import interaction row: %s", exc)
                if total_processed % 500 == 0:
                    logger.info(
                        "Progress: processed=%d inserted=%d skipped=%d errors=%d",
                        total_processed,
                        inserted,
                        skipped_no_rxcui,
                        errors,
                    )
    if not args.dry_run and batch:
        inserted += _flush_batch(database.db_engine, batch, args.dry_run)
        batch.clear()

    logger.info(
        "Kaggle import done: inserted=%s skipped_no_rxcui=%s errors=%s dry_run=%s",
        inserted,
        skipped_no_rxcui,
        errors,
        args.dry_run,
    )


if __name__ == "__main__":
    main(sys.argv[1:])
