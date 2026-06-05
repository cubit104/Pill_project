from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import text

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import database  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("refresh_drug_interactions")

OPENFDA_URL = "https://api.fda.gov/drug/label.json"
RXNORM_URL = "https://rxnav.nlm.nih.gov/REST/rxcui.json"


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Refresh drug interaction cache from OpenFDA")
    parser.add_argument("--dry-run", action="store_true", default=False)
    parser.add_argument("--days-back", type=int, default=7, dest="days_back")
    return parser.parse_args(argv)


def _resolve_rxcui(client: httpx.Client, name: str) -> str | None:
    cleaned = (name or "").strip()
    if not cleaned:
        return None
    try:
        response = client.get(RXNORM_URL, params={"name": cleaned, "allsrc": 0}, timeout=10)
        if response.status_code != 200:
            return None
        ids = (((response.json() or {}).get("idGroup") or {}).get("rxnormId") or [])
        if ids:
            return str(ids[0]).strip()
    except Exception:
        return None
    return None


def _fetch_interaction_text_by_rxcui(client: httpx.Client, rxcui: str) -> tuple[str, str]:
    response = client.get(OPENFDA_URL, params={"search": f"openfda.rxcui:{rxcui}", "limit": 1}, timeout=12)
    if response.status_code != 200:
        return "", ""
    payload = response.json() or {}
    result = (payload.get("results") or [{}])[0]
    text_value = " ".join([x.strip() for x in (result.get("drug_interactions") or []) if x]).strip()
    openfda = result.get("openfda") or {}
    drug_name = ((openfda.get("generic_name") or [None])[0]) or ((openfda.get("brand_name") or [None])[0]) or ""
    return str(drug_name).strip(), text_value


def _upsert_text(conn, rxcui: str, drug_name: str, interaction_text: str, dry_run: bool) -> None:
    if dry_run or not interaction_text:
        return
    conn.execute(
        text(
            """
            INSERT INTO drug_interactions_text (rxcui, drug_name, interactions_text, source, updated_at)
            VALUES (:rxcui, :drug_name, :interactions_text, 'openfda', NOW())
            ON CONFLICT (rxcui) DO UPDATE
            SET drug_name = EXCLUDED.drug_name,
                interactions_text = EXCLUDED.interactions_text,
                source = EXCLUDED.source,
                updated_at = NOW()
            """
        ),
        {"rxcui": rxcui, "drug_name": drug_name, "interactions_text": interaction_text},
    )


def _attempt_pair_match(conn, rxcui: str, interaction_text: str, dry_run: bool) -> int:
    if not interaction_text:
        return 0
    text_lower = interaction_text.lower()
    rows = conn.execute(
        text(
            """
            SELECT id, rxcui_1, rxcui_2, drug_name_1, drug_name_2, source_kaggle
            FROM drug_interactions
            WHERE rxcui_1 = :r OR rxcui_2 = :r
            """
        ),
        {"r": rxcui},
    ).fetchall()

    updates = 0
    for row in rows:
        other_name = row[4] if str(row[1]) == str(rxcui) else row[3]
        if other_name and str(other_name).lower() in text_lower:
            updates += 1
            if dry_run:
                continue
            conn.execute(
                text(
                    """
                    UPDATE drug_interactions
                    SET source_openfda = TRUE,
                        confidence = CASE WHEN source_kaggle THEN 'high' ELSE 'medium' END,
                        updated_at = NOW()
                    WHERE id = :id
                    """
                ),
                {"id": row[0]},
            )
    return updates


def _fetch_recent_label_results(client: httpx.Client, days_back: int) -> list[dict]:
    since = (datetime.now(timezone.utc) - timedelta(days=days_back)).strftime("%Y%m%d")
    response = client.get(
        OPENFDA_URL,
        params={"search": f"effective_time:[{since} TO 99991231]", "limit": 100},
        timeout=15,
    )
    if response.status_code != 200:
        return []
    return (response.json() or {}).get("results") or []


def main(argv: list[str] | None = None) -> None:
    args = _parse_args(argv)

    if not database.db_engine and not database.connect_to_database():
        raise RuntimeError("Database connection not available")

    processed = 0
    upserted = 0
    matched = 0
    errors = 0

    with database.db_engine.begin() as conn:
        stale_rows = conn.execute(
            text(
                """
                SELECT rxcui
                FROM drug_interactions_text
                WHERE updated_at < NOW() - INTERVAL '30 days'
                """
            )
        ).fetchall()

        with httpx.Client(timeout=15) as client:
            recent = _fetch_recent_label_results(client, args.days_back)
            target_rxcuis: set[str] = {str(r[0]).strip() for r in stale_rows if r and r[0]}

            for item in recent:
                openfda = item.get("openfda") or {}
                for rxcui in openfda.get("rxcui") or []:
                    if rxcui:
                        target_rxcuis.add(str(rxcui).strip())
                if not (openfda.get("rxcui") or []):
                    name = ((openfda.get("generic_name") or [None])[0]) or ((openfda.get("brand_name") or [None])[0])
                    resolved = _resolve_rxcui(client, str(name or ""))
                    if resolved:
                        target_rxcuis.add(resolved)

            for rxcui in sorted(target_rxcuis):
                processed += 1
                try:
                    drug_name, interaction_text = _fetch_interaction_text_by_rxcui(client, rxcui)
                    if interaction_text:
                        _upsert_text(conn, rxcui, drug_name, interaction_text, args.dry_run)
                        upserted += 1
                        matched += _attempt_pair_match(conn, rxcui, interaction_text, args.dry_run)
                except Exception as exc:
                    errors += 1
                    logger.warning("Refresh failed for %s: %s", rxcui, exc)
                finally:
                    time.sleep(0.3)

    logger.info(
        "Refresh complete: processed=%s upserted=%s matched=%s errors=%s dry_run=%s days_back=%s",
        processed,
        upserted,
        matched,
        errors,
        args.dry_run,
        args.days_back,
    )


if __name__ == "__main__":
    main(sys.argv[1:])
