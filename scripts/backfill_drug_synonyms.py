"""CLI script: populate drug_synonyms and rxcui_to_ingredient from the free RxNorm API.

Strategy
--------
For every distinct product-level rxcui in ``pillfinder`` (read-only), the script:

1. Calls ``/REST/rxcui/{product_rxcui}/related.json?tty=IN+MIN`` to resolve the
   active-ingredient rxcui (``IN`` = single ingredient, ``MIN`` = combination).
2. Calls ``/REST/rxcui/{product_rxcui}/properties.json`` to record the product's
   own tty (SCD, SBD, GPCK, BPCK, …).
3. For the resolved ingredient rxcui, calls
   ``/REST/rxcui/{ingredient_rxcui}/related.json?tty=BN`` to collect brand names.
4. Gets a clean generic name from ``/REST/rxcui/{ingredient_rxcui}/properties.json``.
5. Upserts one row into ``drug_synonyms`` (keyed on ``ingredient_rxcui``) and one
   row into ``rxcui_to_ingredient`` (keyed on ``product_rxcui``).
6. Logs every product rxcui to ``drug_synonyms_backfill_log``.

Caching: ingredient resolution and synonym data are cached per run in dicts so
multiple ``pillfinder`` rows sharing the same ingredient (e.g. 100 atorvastatin
products → 1 ingredient) never re-hit the API.

API endpoints used (all free, no key required)
----------------------------------------------
  https://rxnav.nlm.nih.gov/REST/rxcui/{rxcui}/related.json?tty=IN+MIN
  https://rxnav.nlm.nih.gov/REST/rxcui/{rxcui}/related.json?tty=BN
  https://rxnav.nlm.nih.gov/REST/rxcui/{rxcui}/properties.json

Usage
-----
    python scripts/backfill_drug_synonyms.py --dry-run --limit 20
    python scripts/backfill_drug_synonyms.py --limit 100000 --sleep-ms 250
    python scripts/backfill_drug_synonyms.py --limit 100000 --refresh-existing --sleep-ms 250
    python scripts/backfill_drug_synonyms.py --only-product-rxcui 1049502

Flags
-----
--dry-run                Fetch but do not write to any table.
--limit N                Process at most N product rxcuis (default: 50).
--offset N               Skip first N rows (default: 0).
--sleep-ms N             Milliseconds between API calls (default: 250).
--refresh-existing       Re-fetch and overwrite rows that already exist.
--only-product-rxcui R   Process a single product rxcui only (for testing).
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from typing import Dict, List, Optional, Tuple

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("backfill_drug_synonyms")

# Allow running from repository root OR from within scripts/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# ---------------------------------------------------------------------------
# RxNorm API endpoints
# ---------------------------------------------------------------------------

_RXNORM_BASE = "https://rxnav.nlm.nih.gov/REST"
_RELATED_URL = _RXNORM_BASE + "/rxcui/{rxcui}/related.json"
_PROPERTIES_URL = _RXNORM_BASE + "/rxcui/{rxcui}/properties.json"

# ---------------------------------------------------------------------------
# SQL
# ---------------------------------------------------------------------------

_SELECT_PRODUCT_RXCUIS_SQL = """
    SELECT DISTINCT TRIM(rxcui) AS product_rxcui
    FROM pillfinder
    WHERE deleted_at IS NULL
      AND rxcui IS NOT NULL AND TRIM(rxcui) <> ''
    ORDER BY product_rxcui
    LIMIT :limit OFFSET :offset
"""

_SELECT_SINGLE_RXCUI_SQL = """
    SELECT DISTINCT TRIM(rxcui) AS product_rxcui
    FROM pillfinder
    WHERE deleted_at IS NULL
      AND TRIM(rxcui) = :rxcui
    LIMIT 1
"""

_SELECT_EXISTING_MAPPING_SQL = """
    SELECT ingredient_rxcui FROM rxcui_to_ingredient WHERE product_rxcui = :p
"""

_UPSERT_DRUG_SYNONYMS_SQL = """
    INSERT INTO drug_synonyms (ingredient_rxcui, generic_name, brand_names, source, notes)
    VALUES (:ing, :gn, :bn, 'rxnorm', :notes)
    ON CONFLICT (ingredient_rxcui) DO NOTHING
"""

_UPSERT_DRUG_SYNONYMS_REFRESH_SQL = """
    INSERT INTO drug_synonyms (ingredient_rxcui, generic_name, brand_names, source, notes)
    VALUES (:ing, :gn, :bn, 'rxnorm', :notes)
    ON CONFLICT (ingredient_rxcui) DO UPDATE
      SET generic_name = EXCLUDED.generic_name,
          brand_names  = EXCLUDED.brand_names,
          updated_at   = NOW()
"""

_UPSERT_MAPPING_SQL = """
    INSERT INTO rxcui_to_ingredient (product_rxcui, ingredient_rxcui, product_tty)
    VALUES (:p, :i, :tty)
    ON CONFLICT (product_rxcui) DO NOTHING
"""

_UPSERT_MAPPING_REFRESH_SQL = """
    INSERT INTO rxcui_to_ingredient (product_rxcui, ingredient_rxcui, product_tty)
    VALUES (:p, :i, :tty)
    ON CONFLICT (product_rxcui) DO UPDATE
      SET ingredient_rxcui = EXCLUDED.ingredient_rxcui,
          product_tty      = EXCLUDED.product_tty
"""

_INSERT_LOG_SQL = """
    INSERT INTO drug_synonyms_backfill_log
      (ingredient_rxcui, product_rxcui, generic_name, brand_count, outcome, source, notes)
    VALUES
      (:ingredient_rxcui, :product_rxcui, :generic_name, :brand_count, :outcome, :source, :notes)
"""

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------


def _parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description=(
            "Populate drug_synonyms and rxcui_to_ingredient tables "
            "from the free RxNorm API."
        )
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        dest="dry_run",
        help="Fetch but do not write to any table.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=50,
        metavar="N",
        help="Process at most N product rxcuis (default: 50).",
    )
    parser.add_argument(
        "--offset",
        type=int,
        default=0,
        metavar="N",
        help="Skip first N rows (default: 0).",
    )
    parser.add_argument(
        "--sleep-ms",
        type=int,
        default=250,
        metavar="N",
        dest="sleep_ms",
        help="Milliseconds between API calls (default: 250).",
    )
    parser.add_argument(
        "--refresh-existing",
        action="store_true",
        default=False,
        dest="refresh_existing",
        help="Re-fetch and overwrite rows that already exist.",
    )
    parser.add_argument(
        "--only-product-rxcui",
        default=None,
        metavar="RXCUI",
        dest="only_product_rxcui",
        help="Process a single product rxcui only (for testing).",
    )
    return parser.parse_args(argv)


# ---------------------------------------------------------------------------
# RxNorm API helpers
# ---------------------------------------------------------------------------


def _fetch_json(
    url: str,
    params: Optional[Dict] = None,
    timeout: int = 15,
    client: Optional["httpx.Client"] = None,  # type: ignore[name-defined]
) -> Optional[Dict]:
    """GET url with one retry on 5xx / timeout. Returns parsed JSON or None.

    If *client* is provided it is reused (connection pooling); otherwise a
    temporary client is created per call.
    """
    import httpx

    _close = client is None
    if _close:
        client = httpx.Client(timeout=timeout)
    try:
        for attempt in range(2):
            try:
                resp = client.get(url, params=params)
                if resp.status_code == 200:
                    return resp.json()
                if resp.status_code >= 500 and attempt == 0:
                    time.sleep(1)
                    continue
                logger.debug("HTTP %s from %s", resp.status_code, url)
                return None
            except Exception as exc:
                if attempt == 0:
                    time.sleep(1)
                    continue
                logger.warning("HTTP error fetching %s: %s", url, exc)
                return None
    finally:
        if _close:
            client.close()
    return None


def fetch_properties(
    rxcui: str,
    client: Optional["httpx.Client"] = None,  # type: ignore[name-defined]
) -> Optional[Dict]:
    """Return the ``properties`` sub-dict from RxNorm /properties.json, or None."""
    url = _PROPERTIES_URL.format(rxcui=rxcui)
    data = _fetch_json(url, client=client)
    if not data:
        return None
    return data.get("properties") or None


def fetch_ingredient(
    product_rxcui: str,
    client: Optional["httpx.Client"] = None,  # type: ignore[name-defined]
) -> Optional[Tuple[str, str, str]]:
    """Resolve product rxcui → (ingredient_rxcui, ingredient_name, product_tty).

    Calls /related.json?tty=IN+MIN to find the active-ingredient concept, and
    /properties.json to get the product's own tty.

    Returns None if no IN/MIN concept is found.
    """
    # 1. Resolve ingredient via IN/MIN related call
    related_url = f"{_RELATED_URL.format(rxcui=product_rxcui)}?tty=IN+MIN"
    data = _fetch_json(related_url, client=client)

    ingredient_rxcui: Optional[str] = None
    ingredient_name: Optional[str] = None

    if data:
        concept_groups = (
            data.get("relatedGroup", {}).get("conceptGroup") or []
        )
        for group in concept_groups:
            tty = group.get("tty", "")
            if tty not in ("IN", "MIN"):
                continue
            for concept in group.get("conceptProperties") or []:
                rxcui_val = concept.get("rxcui", "").strip()
                name_val = concept.get("name", "").strip()
                if rxcui_val:
                    ingredient_rxcui = rxcui_val
                    ingredient_name = name_val
                    break
            if ingredient_rxcui:
                break

    if not ingredient_rxcui:
        return None

    # 2. Get product's own tty
    product_tty: str = ""
    props = fetch_properties(product_rxcui, client=client)
    if props:
        product_tty = props.get("tty", "") or ""

    return ingredient_rxcui, ingredient_name or "", product_tty


def fetch_brand_names(
    ingredient_rxcui: str,
    client: Optional["httpx.Client"] = None,  # type: ignore[name-defined]
) -> List[str]:
    """Return a deduplicated list of brand names for an ingredient rxcui.

    Calls /related.json?tty=BN and collects all conceptProperties[*].name
    values.  Deduplication is case-insensitive; first-seen casing is preserved.
    Entirely upper-case names are title-cased.

    Returns an empty list if none are found.
    """
    url = _RELATED_URL.format(rxcui=ingredient_rxcui)
    data = _fetch_json(url, params={"tty": "BN"}, client=client)
    if not data:
        return []

    seen_lower: Dict[str, str] = {}  # lower → first-seen casing
    concept_groups = (
        data.get("relatedGroup", {}).get("conceptGroup") or []
    )
    for group in concept_groups:
        if group.get("tty") != "BN":
            continue
        for concept in group.get("conceptProperties") or []:
            name = (concept.get("name") or "").strip()
            if not name:
                continue
            # Title-case if entirely upper-case (e.g. "LIPITOR" → "Lipitor")
            if name == name.upper() and any(c.isalpha() for c in name):
                name = name.title()
            lower = name.lower()
            if lower not in seen_lower:
                seen_lower[lower] = name

    return list(seen_lower.values())


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------


def _write_log(
    conn,
    *,
    ingredient_rxcui: Optional[str],
    product_rxcui: str,
    generic_name: Optional[str],
    brand_count: Optional[int],
    outcome: str,
    notes: Optional[str],
) -> None:
    from sqlalchemy import text

    conn.execute(
        text(_INSERT_LOG_SQL),
        {
            "ingredient_rxcui": ingredient_rxcui,
            "product_rxcui": product_rxcui,
            "generic_name": generic_name,
            "brand_count": brand_count,
            "outcome": outcome,
            "source": "rxnorm",
            "notes": notes,
        },
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main(argv=None):
    args = _parse_args(argv)

    if not args.dry_run:
        logger.warning(
            "⚠️  LIVE MODE — rows will be written to drug_synonyms and "
            "rxcui_to_ingredient. Always run with --dry-run first."
        )
    else:
        logger.info("DRY-RUN mode — no changes will be written to the database.")

    logger.info(
        "Starting drug_synonyms backfill: dry_run=%s limit=%d offset=%d "
        "sleep_ms=%d refresh_existing=%s only_product_rxcui=%s",
        args.dry_run,
        args.limit,
        args.offset,
        args.sleep_ms,
        args.refresh_existing,
        args.only_product_rxcui,
    )

    sleep_s = args.sleep_ms / 1000.0

    # --- DB setup ---
    db_engine = None
    try:
        import database

        if not database.db_engine:
            if not database.connect_to_database():
                logger.error("Cannot connect to database. Aborting.")
                sys.exit(1)
        db_engine = database.db_engine
    except Exception as exc:
        logger.error("DB setup failed: %s", exc)
        sys.exit(1)

    from sqlalchemy import text

    # --- Fetch product rxcuis ---
    try:
        with db_engine.connect() as conn:
            if args.only_product_rxcui:
                rows = conn.execute(
                    text(_SELECT_SINGLE_RXCUI_SQL),
                    {"rxcui": args.only_product_rxcui.strip()},
                ).fetchall()
            else:
                rows = conn.execute(
                    text(_SELECT_PRODUCT_RXCUIS_SQL),
                    {"limit": args.limit, "offset": args.offset},
                ).fetchall()
    except Exception as exc:
        logger.error("Failed to select product rxcuis from pillfinder: %s", exc)
        sys.exit(1)

    if not rows:
        logger.info("No product rxcuis to process.")
        summary = {
            "processed": 0,
            "inserted_mapping": 0,
            "inserted_synonym": 0,
            "updated_synonym": 0,
            "unchanged": 0,
            "no_match": 0,
            "errors": 0,
            "dry_run": args.dry_run,
        }
        print(json.dumps(summary))
        sys.exit(0)

    # --- Process rows ---
    counters = {
        "processed": 0,
        "inserted_mapping": 0,
        "inserted_synonym": 0,
        "updated_synonym": 0,
        "unchanged": 0,
        "no_match": 0,
        "errors": 0,
    }

    # Per-run caches to avoid redundant API calls
    # product_rxcui → (ingredient_rxcui, ingredient_name, product_tty)
    ingredient_cache: Dict[str, Tuple[str, str, str]] = {}
    # ingredient_rxcui → (generic_name, brand_names_list)
    synonyms_cache: Dict[str, Tuple[str, List[str]]] = {}

    import httpx

    with httpx.Client(timeout=15) as http_client:
        for row in rows:
            product_rxcui: str = row.product_rxcui
            counters["processed"] += 1

            try:
                _process_product_rxcui(
                    product_rxcui=product_rxcui,
                    db_engine=db_engine,
                    http_client=http_client,
                    args=args,
                    sleep_s=sleep_s,
                    counters=counters,
                    ingredient_cache=ingredient_cache,
                    synonyms_cache=synonyms_cache,
                )
            except Exception as exc:
                logger.error(
                    "Unexpected error processing product_rxcui=%s: %s",
                    product_rxcui,
                    exc,
                )
                counters["errors"] += 1
                try:
                    with db_engine.begin() as conn:
                        _write_log(
                            conn,
                            ingredient_rxcui=None,
                            product_rxcui=product_rxcui,
                            generic_name=None,
                            brand_count=None,
                            outcome="error",
                            notes=f"Unexpected error: {exc}",
                        )
                except Exception:
                    pass

    # --- Summary ---
    summary = {
        "processed": counters["processed"],
        "inserted_mapping": counters["inserted_mapping"],
        "inserted_synonym": counters["inserted_synonym"],
        "updated_synonym": counters["updated_synonym"],
        "unchanged": counters["unchanged"],
        "no_match": counters["no_match"],
        "errors": counters["errors"],
        "dry_run": args.dry_run,
    }
    print(json.dumps(summary))
    logger.info("Done: %s", summary)


def _process_product_rxcui(
    *,
    product_rxcui: str,
    db_engine,
    http_client,
    args,
    sleep_s: float,
    counters: Dict,
    ingredient_cache: Dict,
    synonyms_cache: Dict,
) -> None:
    """Handle a single product rxcui — resolve ingredient, fetch synonyms, write DB."""
    from sqlalchemy import text

    # --- Check if mapping already exists ---
    existing_ingredient: Optional[str] = None
    try:
        with db_engine.connect() as conn:
            existing_row = conn.execute(
                text(_SELECT_EXISTING_MAPPING_SQL),
                {"p": product_rxcui},
            ).fetchone()
            if existing_row:
                existing_ingredient = existing_row[0]
    except Exception as exc:
        raise RuntimeError(f"DB lookup failed for product_rxcui={product_rxcui}: {exc}") from exc

    if existing_ingredient and not args.refresh_existing:
        logger.info(
            "↪ product_rxcui=%s already mapped to ingredient=%s (skipped)",
            product_rxcui,
            existing_ingredient,
        )
        counters["unchanged"] += 1
        try:
            with db_engine.begin() as conn:
                _write_log(
                    conn,
                    ingredient_rxcui=existing_ingredient,
                    product_rxcui=product_rxcui,
                    generic_name=None,
                    brand_count=None,
                    outcome="skipped_exists",
                    notes="mapping already present; use --refresh-existing to overwrite",
                )
        except Exception as exc:
            logger.warning("Failed to write audit log for product_rxcui=%s: %s", product_rxcui, exc)
        return

    # --- Resolve ingredient (with cache) ---
    if product_rxcui in ingredient_cache:
        ingredient_info = ingredient_cache[product_rxcui]
    else:
        try:
            ingredient_info = fetch_ingredient(product_rxcui, client=http_client)
            time.sleep(sleep_s)
        except Exception as exc:
            logger.error("fetch_ingredient failed for product_rxcui=%s: %s", product_rxcui, exc)
            counters["errors"] += 1
            try:
                with db_engine.begin() as conn:
                    _write_log(
                        conn,
                        ingredient_rxcui=None,
                        product_rxcui=product_rxcui,
                        generic_name=None,
                        brand_count=None,
                        outcome="error",
                        notes=f"fetch_ingredient: {exc}",
                    )
            except Exception:
                pass
            return

        ingredient_cache[product_rxcui] = ingredient_info  # type: ignore[assignment]

    if ingredient_info is None:
        logger.info("↪ product_rxcui=%s — no IN/MIN ingredient found (no_match)", product_rxcui)
        counters["no_match"] += 1
        try:
            with db_engine.begin() as conn:
                _write_log(
                    conn,
                    ingredient_rxcui=None,
                    product_rxcui=product_rxcui,
                    generic_name=None,
                    brand_count=None,
                    outcome="no_match",
                    notes="RxNorm returned no IN/MIN concept for this rxcui",
                )
        except Exception as exc:
            logger.warning("Failed to write audit log for product_rxcui=%s: %s", product_rxcui, exc)
        return

    ingredient_rxcui, _raw_name, product_tty = ingredient_info

    # --- Resolve synonyms (with cache) ---
    if ingredient_rxcui in synonyms_cache:
        generic_name, brand_names = synonyms_cache[ingredient_rxcui]
    else:
        try:
            # Fetch clean generic name from ingredient properties
            ing_props = fetch_properties(ingredient_rxcui, client=http_client)
            time.sleep(sleep_s)
            raw_gn = (ing_props or {}).get("name", "") or _raw_name or ""
            # Lower-case if entirely upper-case
            if raw_gn == raw_gn.upper() and any(c.isalpha() for c in raw_gn):
                generic_name = raw_gn.lower()
            else:
                generic_name = raw_gn

            brand_names = fetch_brand_names(ingredient_rxcui, client=http_client)
            time.sleep(sleep_s)
        except Exception as exc:
            logger.error(
                "fetch synonyms failed for ingredient_rxcui=%s: %s", ingredient_rxcui, exc
            )
            counters["errors"] += 1
            try:
                with db_engine.begin() as conn:
                    _write_log(
                        conn,
                        ingredient_rxcui=ingredient_rxcui,
                        product_rxcui=product_rxcui,
                        generic_name=None,
                        brand_count=None,
                        outcome="error",
                        notes=f"fetch_synonyms: {exc}",
                    )
            except Exception:
                pass
            return

        synonyms_cache[ingredient_rxcui] = (generic_name, brand_names)

    notes_str = f"product_tty={product_tty}" if product_tty else None

    if args.dry_run:
        logger.info(
            "✓ product_rxcui=%s → ingredient=%s generic=%r brands=%d (dry-run)",
            product_rxcui,
            ingredient_rxcui,
            generic_name,
            len(brand_names),
        )
        counters["inserted_mapping"] += 1  # would-be insert
        try:
            with db_engine.begin() as conn:
                _write_log(
                    conn,
                    ingredient_rxcui=ingredient_rxcui,
                    product_rxcui=product_rxcui,
                    generic_name=generic_name,
                    brand_count=len(brand_names),
                    outcome="dry_run",
                    notes=notes_str,
                )
        except Exception as exc:
            logger.warning("Failed to write audit log for product_rxcui=%s: %s", product_rxcui, exc)
        return

    # --- Live writes ---
    synonym_upsert_sql = (
        _UPSERT_DRUG_SYNONYMS_REFRESH_SQL if args.refresh_existing else _UPSERT_DRUG_SYNONYMS_SQL
    )
    mapping_upsert_sql = (
        _UPSERT_MAPPING_REFRESH_SQL if args.refresh_existing else _UPSERT_MAPPING_SQL
    )

    try:
        with db_engine.begin() as conn:
            # 1. Upsert drug_synonyms
            result_syn = conn.execute(
                text(synonym_upsert_sql),
                {
                    "ing": ingredient_rxcui,
                    "gn": generic_name,
                    "bn": brand_names,
                    "notes": notes_str,
                },
            )
            synonym_inserted = (result_syn.rowcount or 0) > 0

            # 2. Upsert rxcui_to_ingredient
            result_map = conn.execute(
                text(mapping_upsert_sql),
                {
                    "p": product_rxcui,
                    "i": ingredient_rxcui,
                    "tty": product_tty or None,
                },
            )
            mapping_inserted = (result_map.rowcount or 0) > 0

            # Determine outcome
            if existing_ingredient and args.refresh_existing:
                outcome = "updated"
            elif mapping_inserted or synonym_inserted:
                outcome = "inserted"
            else:
                outcome = "unchanged"

            _write_log(
                conn,
                ingredient_rxcui=ingredient_rxcui,
                product_rxcui=product_rxcui,
                generic_name=generic_name,
                brand_count=len(brand_names),
                outcome=outcome,
                notes=notes_str,
            )

        if outcome == "inserted":
            counters["inserted_mapping"] += 1
            if synonym_inserted:
                counters["inserted_synonym"] += 1
            logger.info(
                "✓ product_rxcui=%s → ingredient=%s generic=%r brands=%d [inserted]",
                product_rxcui,
                ingredient_rxcui,
                generic_name,
                len(brand_names),
            )
        elif outcome == "updated":
            counters["updated_synonym"] += 1
            logger.info(
                "✓ product_rxcui=%s → ingredient=%s generic=%r brands=%d [updated]",
                product_rxcui,
                ingredient_rxcui,
                generic_name,
                len(brand_names),
            )
        else:
            counters["unchanged"] += 1
            logger.info(
                "↪ product_rxcui=%s → ingredient=%s [unchanged]",
                product_rxcui,
                ingredient_rxcui,
            )

    except Exception as exc:
        logger.error("DB write failed for product_rxcui=%s: %s", product_rxcui, exc)
        counters["errors"] += 1
        try:
            with db_engine.begin() as conn:
                _write_log(
                    conn,
                    ingredient_rxcui=ingredient_rxcui,
                    product_rxcui=product_rxcui,
                    generic_name=generic_name,
                    brand_count=len(brand_names),
                    outcome="error",
                    notes=f"DB write failed: {exc}",
                )
        except Exception:
            pass


if __name__ == "__main__":
    main(sys.argv[1:])
