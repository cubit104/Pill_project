import logging
import time
from typing import Dict, Optional

import httpx
from sqlalchemy import text

logger = logging.getLogger(__name__)

_RXNORM_BASE = "https://rxnav.nlm.nih.gov/REST"
_RELATED_URL = _RXNORM_BASE + "/rxcui/{rxcui}/related.json"
_PROPERTIES_URL = _RXNORM_BASE + "/rxcui/{rxcui}/properties.json"


def _fetch_json(
    url: str,
    params: Optional[Dict] = None,
    timeout: int = 15,
    client: Optional[httpx.Client] = None,
) -> Optional[Dict]:
    _close = client is None
    if _close:
        client = httpx.Client(timeout=timeout)
    try:
        for attempt in range(2):
            try:
                resp = client.get(url, params=params, timeout=timeout)
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


def _remaining_seconds(deadline: float) -> float:
    return max(0.0, deadline - time.monotonic())


def _normalize_display_name(name: str) -> str:
    cleaned = (name or "").strip()
    if cleaned == cleaned.upper() and any(c.isalpha() for c in cleaned):
        return cleaned.title()
    return cleaned


def _dedupe_sort_brands(names: list[str]) -> list[str]:
    by_lower: Dict[str, str] = {}
    for raw in names:
        nice = _normalize_display_name(raw)
        if not nice:
            continue
        lower = nice.lower()
        if lower not in by_lower:
            by_lower[lower] = nice
    return sorted(by_lower.values(), key=lambda n: n.lower())


def ensure_synonym_mapping(conn, product_rxcui: str) -> None:
    """Idempotent best-effort mapping resolver for admin writes."""
    product_rxcui = (product_rxcui or "").strip()
    if not product_rxcui:
        return

    deadline = time.monotonic() + 5.0

    try:
        existing = conn.execute(
            text("SELECT ingredient_rxcui FROM rxcui_to_ingredient WHERE product_rxcui = :p LIMIT 1"),
            {"p": product_rxcui},
        ).fetchone()
        if existing:
            return

        if _remaining_seconds(deadline) <= 0:
            return

        with httpx.Client(timeout=max(0.5, min(15.0, _remaining_seconds(deadline)))) as client:
            related_timeout = max(0.5, min(15.0, _remaining_seconds(deadline)))
            related = _fetch_json(
                f"{_RELATED_URL.format(rxcui=product_rxcui)}?tty=IN+MIN",
                client=client,
                timeout=related_timeout,
            )
            ingredient_rxcui = None
            ingredient_name = ""
            for group in (related or {}).get("relatedGroup", {}).get("conceptGroup") or []:
                if group.get("tty") not in ("IN", "MIN"):
                    continue
                for concept in group.get("conceptProperties") or []:
                    ingredient_rxcui = (concept.get("rxcui") or "").strip()
                    ingredient_name = (concept.get("name") or "").strip()
                    if ingredient_rxcui:
                        break
                if ingredient_rxcui:
                    break

            if not ingredient_rxcui:
                return

            if _remaining_seconds(deadline) <= 0:
                return

            product_props = _fetch_json(
                _PROPERTIES_URL.format(rxcui=product_rxcui),
                client=client,
                timeout=max(0.5, min(15.0, _remaining_seconds(deadline))),
            ) or {}
            product_tty = ((product_props.get("properties") or {}).get("tty") or "").strip() or None

            synonym_row = conn.execute(
                text("SELECT 1 FROM drug_synonyms WHERE ingredient_rxcui = :ing LIMIT 1"),
                {"ing": ingredient_rxcui},
            ).fetchone()

            if not synonym_row and _remaining_seconds(deadline) > 0:
                if _remaining_seconds(deadline) <= 0:
                    return
                ing_props = _fetch_json(
                    _PROPERTIES_URL.format(rxcui=ingredient_rxcui),
                    client=client,
                    timeout=max(0.5, min(15.0, _remaining_seconds(deadline))),
                ) or {}
                generic_name = (
                    ((ing_props.get("properties") or {}).get("name") or ingredient_name or "").strip()
                )
                generic_name = _normalize_display_name(generic_name)

                if _remaining_seconds(deadline) <= 0:
                    return
                brand_related = _fetch_json(
                    f"{_RELATED_URL.format(rxcui=ingredient_rxcui)}?tty=BN",
                    client=client,
                    timeout=max(0.5, min(15.0, _remaining_seconds(deadline))),
                ) or {}
                raw_brands: list[str] = []
                for group in (brand_related.get("relatedGroup", {}).get("conceptGroup") or []):
                    if group.get("tty") != "BN":
                        continue
                    for concept in group.get("conceptProperties") or []:
                        raw_brands.append((concept.get("name") or "").strip())
                brand_names = _dedupe_sort_brands(raw_brands)

                conn.execute(
                    text(
                        """
                        INSERT INTO drug_synonyms (ingredient_rxcui, generic_name, brand_names, source, notes)
                        VALUES (:ing, :gn, :bn, 'rxnorm', :notes)
                        ON CONFLICT (ingredient_rxcui) DO NOTHING
                        """
                    ),
                    {
                        "ing": ingredient_rxcui,
                        "gn": generic_name,
                        "bn": brand_names,
                        "notes": f"product_rxcui={product_rxcui}",
                    },
                )

            conn.execute(
                text(
                    """
                    INSERT INTO rxcui_to_ingredient (product_rxcui, ingredient_rxcui, product_tty)
                    VALUES (:p, :i, :tty)
                    ON CONFLICT (product_rxcui) DO NOTHING
                    """
                ),
                {"p": product_rxcui, "i": ingredient_rxcui, "tty": product_tty},
            )
    except Exception as exc:
        logger.warning("ensure_synonym_mapping failed for rxcui=%s: %s", product_rxcui, exc)


def get_synonyms_for_rxcui(conn, product_rxcui: str) -> dict:
    """Return synonym mapping details for a product rxcui, or {}."""
    product_rxcui = (product_rxcui or "").strip()
    if not product_rxcui:
        return {}

    row = conn.execute(
        text(
            """
            SELECT
                r.ingredient_rxcui,
                s.generic_name,
                s.brand_names,
                r.product_tty
            FROM rxcui_to_ingredient r
            JOIN drug_synonyms s ON s.ingredient_rxcui = r.ingredient_rxcui
            WHERE r.product_rxcui = :p
            LIMIT 1
            """
        ),
        {"p": product_rxcui},
    ).fetchone()
    if not row:
        return {}

    brands = row[2] or []
    return {
        "ingredient_rxcui": row[0],
        "generic_name": row[1],
        "brand_names": sorted([b for b in brands if b], key=lambda n: n.lower()),
        "product_tty": row[3],
    }


def filter_self_from_brands(brand_names: list[str], medicine_name: str) -> list[str]:
    """Remove the current medicine_name from a brand-name list, case-insensitively."""
    own = (medicine_name or "").strip().lower()
    if not own:
        return list(brand_names or [])
    return [b for b in (brand_names or []) if (b or "").strip().lower() != own]
