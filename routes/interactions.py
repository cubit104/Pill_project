from __future__ import annotations

import logging
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Path, Query
from pydantic import BaseModel
from sqlalchemy import text

import database
from services.interaction_spl_extract import extract_targeted_paragraph

logger = logging.getLogger(__name__)
router = APIRouter()

RXNORM_URL = "https://rxnav.nlm.nih.gov/REST/rxcui.json"
OPENFDA_URL = "https://api.fda.gov/drug/label.json"
_VALID_SEVERITIES = frozenset({"major", "moderate", "minor", "unknown"})


class InteractionResponse(BaseModel):
    drug1: str
    drug2: str
    drug1_generic: Optional[str] = None
    drug2_generic: Optional[str] = None
    drug1_brands: list[str] = []
    drug2_brands: list[str] = []
    drug1_rxcui: Optional[str]
    drug2_rxcui: Optional[str]
    severity: Optional[str]
    description: Optional[str]
    confidence: Optional[str]
    source_kaggle: bool = False
    source_openfda: bool = False
    found: bool
    message: Optional[str] = None


class DrugInteractionItem(BaseModel):
    drug_name: str
    rxcui: Optional[str]
    severity: Optional[str]
    description: Optional[str]
    confidence: Optional[str]
    source_kaggle: bool = False
    source_openfda: bool = False


class SeveritySummary(BaseModel):
    major: int = 0
    moderate: int = 0
    minor: int = 0
    unknown: int = 0


class DrugInteractionsListResponse(BaseModel):
    drug: str
    rxcui: Optional[str]
    generic_name: Optional[str]
    brand_names: list[str] = []
    total: int
    page: int
    per_page: int
    severity_summary: SeveritySummary
    interactions: list[DrugInteractionItem]


def classify_severity(text_value: str) -> str:
    text_value = (text_value or "").lower()
    if any(w in text_value for w in ["contraindicated", "do not use", "life-threatening", "fatal", "serious risk", "avoid combination"]):
        return "major"
    elif any(w in text_value for w in ["avoid", "serious", "significant", "monitor closely", "caution", "reduce dose", "closely monitor"]):
        return "moderate"
    elif any(w in text_value for w in ["minor", "minimal", "slight", "unlikely"]):
        return "minor"
    return "unknown"


def canonical_pair(rxcui_1: str, rxcui_2: str, drug_1: str, drug_2: str) -> tuple[str, str, str, str]:
    if rxcui_1 <= rxcui_2:
        return rxcui_1, rxcui_2, drug_1, drug_2
    return rxcui_2, rxcui_1, drug_2, drug_1


def _resolve_to_ingredient_rxcui(rxcui: str) -> str:
    """Resolve a brand/product RXCUI to an ingredient-level RXCUI using RxNorm.

    Calls GET rxnav.nlm.nih.gov/REST/rxcui/{rxcui}/related.json?tty=IN and
    returns the first ingredient RXCUI found.  Falls back to the original
    ``rxcui`` on any error or empty result.
    """
    try:
        url = f"https://rxnav.nlm.nih.gov/REST/rxcui/{rxcui}/related.json"
        response = httpx.get(url, params={"tty": "IN"}, timeout=10)
        if response.status_code != 200:
            return rxcui
        data = response.json() or {}
        related_group = data.get("relatedGroup") or {}
        concept_groups = related_group.get("conceptGroup") or []
        for group in concept_groups:
            for prop in (group.get("conceptProperties") or []):
                ingredient_rxcui = (prop.get("rxcui") or "").strip()
                if ingredient_rxcui:
                    return ingredient_rxcui
    except Exception as exc:
        logger.warning("Ingredient RXCUI resolution failed for %s: %s", rxcui, exc)
    return rxcui


def resolve_rxcui_from_rxnorm(name: str) -> Optional[str]:
    cleaned = (name or "").strip()
    if not cleaned:
        return None
    try:
        response = httpx.get(RXNORM_URL, params={"name": cleaned, "allsrc": 0}, timeout=10)
        if response.status_code != 200:
            return None
        rxnorm_ids = (((response.json() or {}).get("idGroup") or {}).get("rxnormId") or [])
        if rxnorm_ids:
            raw_rxcui = str(rxnorm_ids[0]).strip()
            return _resolve_to_ingredient_rxcui(raw_rxcui)
    except Exception as exc:
        logger.warning("RxNorm resolution failed for %s: %s", cleaned, exc)
    return None


def resolve_drug_name(conn, name: str) -> dict:
    cleaned = (name or "").strip()
    if not cleaned:
        return {"name": name, "rxcui": None, "generic_name": None, "brand_names": []}

    row = conn.execute(
        text(
            """
            SELECT ingredient_rxcui, generic_name, brand_names
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

    if row:
        return {
            "name": cleaned,
            "rxcui": str(row[0]).strip() if row[0] else None,
            "generic_name": row[1],
            "brand_names": list(row[2] or []),
        }

    return {
        "name": cleaned,
        "rxcui": resolve_rxcui_from_rxnorm(cleaned),
        "generic_name": None,
        "brand_names": [],
    }


def get_interaction_pair(conn, rxcui_1: str, rxcui_2: str) -> Optional[dict]:
    if not rxcui_1 or not rxcui_2:
        return None
    left, right = sorted([str(rxcui_1), str(rxcui_2)])
    row = conn.execute(
        text(
            """
            SELECT rxcui_1, rxcui_2, drug_name_1, drug_name_2, description, severity, confidence, source_kaggle, source_openfda
            FROM drug_interactions
            WHERE rxcui_1 = :r1 AND rxcui_2 = :r2
            LIMIT 1
            """
        ),
        {"r1": left, "r2": right},
    ).fetchone()
    if not row:
        return None
    return {
        "rxcui_1": row[0],
        "rxcui_2": row[1],
        "drug_name_1": row[2],
        "drug_name_2": row[3],
        "description": row[4],
        "severity": row[5],
        "confidence": row[6],
        "source_kaggle": bool(row[7]),
        "source_openfda": bool(row[8]),
    }


def search_cached_label_text(conn, rxcui: str, counterpart_names: set[str]) -> tuple[Optional[str], Optional[str]]:
    row = conn.execute(
        text("SELECT interactions_text, source FROM drug_interactions_text WHERE rxcui = :rxcui LIMIT 1"),
        {"rxcui": rxcui},
    ).fetchone()
    if not row or not row[0] or not counterpart_names:
        return None, None
    text_value = str(row[0])
    source = str(row[1] or "").strip().lower()

    if source == "spl_professional":
        targeted = extract_targeted_paragraph(text_value, counterpart_names)
        if targeted:
            return targeted, source
        return None, None

    if _text_matches_candidates(text_value, counterpart_names):
        return text_value, source
    return None, None


def _candidate_names(resolved: dict, original_name: str) -> set[str]:
    candidates = {(original_name or "").strip().lower()}
    generic = (resolved.get("generic_name") or "").strip().lower()
    if generic:
        candidates.add(generic)
    for brand in (resolved.get("brand_names") or []):
        cleaned_brand = str(brand or "").strip().lower()
        if cleaned_brand:
            candidates.add(cleaned_brand)
    return {c for c in candidates if c}


def _text_matches_candidates(text_value: str, candidate_names: set[str]) -> bool:
    lowered_text = (text_value or "").lower()
    return any(candidate in lowered_text for candidate in candidate_names)


def fetch_openfda_interaction_text(rxcui: str, generic_name: Optional[str]) -> tuple[str, str]:
    generic = (generic_name or "").strip()
    if not generic:
        return "", ""
    response = httpx.get(
        OPENFDA_URL,
        params={"search": f'openfda.generic_name:"{generic}"', "limit": 1},
        timeout=12,
    )
    if response.status_code != 200:
        return "", ""
    payload = response.json() or {}
    result = (payload.get("results") or [{}])[0]
    interaction_text = " ".join([s.strip() for s in (result.get("drug_interactions") or []) if s]).strip()
    openfda = result.get("openfda") or {}
    drug_name = ((openfda.get("generic_name") or [None])[0]) or ((openfda.get("brand_name") or [None])[0]) or ""
    return str(drug_name).strip(), interaction_text


def cache_low_confidence_interaction(conn, rxcui_1: str, rxcui_2: str, drug_1: str, drug_2: str, description: str) -> None:
    r1, r2, n1, n2 = canonical_pair(rxcui_1, rxcui_2, drug_1, drug_2)
    conn.execute(
        text(
            """
            INSERT INTO drug_interactions
                (rxcui_1, rxcui_2, drug_name_1, drug_name_2, description, severity, confidence, source_kaggle, source_openfda, updated_at)
            VALUES
                (:r1, :r2, :n1, :n2, :description, :severity, 'low', FALSE, TRUE, NOW())
            ON CONFLICT (rxcui_1, rxcui_2) DO UPDATE
            SET source_openfda = TRUE,
                confidence = CASE
                    WHEN drug_interactions.source_kaggle THEN 'high'
                    WHEN drug_interactions.source_openfda THEN COALESCE(drug_interactions.confidence, 'low')
                    ELSE 'low'
                END,
                description = EXCLUDED.description,
                severity = EXCLUDED.severity,
                updated_at = NOW()
            """
        ),
        {
            "r1": r1,
            "r2": r2,
            "n1": n1,
            "n2": n2,
            "description": description,
            "severity": classify_severity(description),
        },
    )


def get_interactions_for_drug(
    conn,
    rxcui: str,
    severity: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
) -> tuple[int, dict, list[dict]]:
    """
    Return (total, severity_summary, interactions) for all pairs involving rxcui.
    Handles the canonical ordering — the queried drug may live in rxcui_1 or rxcui_2.
    The severity_summary always reflects the full unfiltered set.
    """
    base_params: dict = {"rxcui": rxcui}
    has_severity_filter = bool(severity and severity in _VALID_SEVERITIES)
    if has_severity_filter:
        base_params["severity"] = severity

    count_sql = """
        SELECT COUNT(*)
        FROM drug_interactions
        WHERE (rxcui_1 = :rxcui OR rxcui_2 = :rxcui)
    """
    if has_severity_filter:
        count_sql += " AND severity = :severity"
    count_row = conn.execute(
        text(count_sql),
        base_params,
    ).fetchone()
    total = int(count_row[0]) if count_row else 0

    # Severity summary always over the full unfiltered set
    summary_rows = conn.execute(
        text(
            """
            SELECT severity, COUNT(*) AS cnt
            FROM drug_interactions
            WHERE rxcui_1 = :rxcui OR rxcui_2 = :rxcui
            GROUP BY severity
            """
        ),
        {"rxcui": rxcui},
    ).fetchall()
    severity_summary: dict = {"major": 0, "moderate": 0, "minor": 0, "unknown": 0}
    for row in summary_rows:
        key = row[0] if row[0] in severity_summary else "unknown"
        severity_summary[key] = int(row[1])

    offset = (page - 1) * per_page
    paginated_params = {**base_params, "limit": per_page, "offset": offset}
    interactions_sql = """
        SELECT
            CASE WHEN rxcui_1 = :rxcui THEN rxcui_2     ELSE rxcui_1     END AS other_rxcui,
            CASE WHEN rxcui_1 = :rxcui THEN drug_name_2  ELSE drug_name_1  END AS other_drug_name,
            severity,
            description,
            confidence,
            source_kaggle,
            source_openfda
        FROM drug_interactions
        WHERE (rxcui_1 = :rxcui OR rxcui_2 = :rxcui)
    """
    if has_severity_filter:
        interactions_sql += " AND severity = :severity"
    interactions_sql += """
        ORDER BY
            CASE severity
                WHEN 'major'    THEN 0
                WHEN 'moderate' THEN 1
                WHEN 'minor'    THEN 2
                ELSE 3
            END,
            CASE WHEN rxcui_1 = :rxcui THEN drug_name_2 ELSE drug_name_1 END
        LIMIT :limit OFFSET :offset
    """
    result_rows = conn.execute(
        text(interactions_sql),
        paginated_params,
    ).fetchall()

    interactions = [
        {
            "drug_name": row[1] or "",
            "rxcui": row[0],
            "severity": row[2],
            "description": row[3],
            "confidence": row[4],
            "source_kaggle": bool(row[5]),
            "source_openfda": bool(row[6]),
        }
        for row in result_rows
    ]
    return total, severity_summary, interactions


@router.get("/api/interactions/suggestions")
def get_interaction_drug_suggestions(
    q: str = Query(..., min_length=1, description="Drug name prefix to search (must be at least 2 characters to return results)"),
    limit: int = Query(10, ge=1, le=20, description="Max suggestions to return"),
):
    """
    Autocomplete suggestions for drug names from drug_interactions and drug_synonyms.
    Queries drug_name_1/drug_name_2 and drug_synonyms brand_names/generic_name for prefix matches.
    Returns a list of unique drug name strings.
    """
    norm_q = q.strip()
    if len(norm_q) < 2:
        return []

    if not database.db_engine and not database.connect_to_database():
        raise HTTPException(status_code=503, detail="Database unavailable")

    lower_q = norm_q.lower()

    with database.db_engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT name FROM (
                    SELECT DISTINCT drug_name_1 AS name
                    FROM drug_interactions
                    WHERE LOWER(drug_name_1) LIKE :prefix
                      AND drug_name_1 IS NOT NULL AND drug_name_1 <> ''
                    UNION
                    SELECT DISTINCT drug_name_2 AS name
                    FROM drug_interactions
                    WHERE LOWER(drug_name_2) LIKE :prefix
                      AND drug_name_2 IS NOT NULL AND drug_name_2 <> ''
                    UNION
                    SELECT DISTINCT bn AS name
                    FROM drug_synonyms, unnest(brand_names) AS bn
                    WHERE LOWER(bn) LIKE :prefix
                      AND bn IS NOT NULL AND bn <> ''
                    UNION
                    SELECT DISTINCT generic_name AS name
                    FROM drug_synonyms
                    WHERE LOWER(generic_name) LIKE :prefix
                      AND generic_name IS NOT NULL AND generic_name <> ''
                ) combined
                ORDER BY name
                LIMIT :lim
                """
            ),
            {"prefix": f"{lower_q}%", "lim": limit},
        ).fetchall()

    seen = set()
    suggestions = []
    for row in rows:
        name = (row[0] or "").strip()
        key = name.lower()
        if name and key not in seen:
            seen.add(key)
            suggestions.append(name)

    return suggestions


@router.get("/api/interactions/resolve")
def resolve_interaction_name(name: str = Query(..., description="Drug name to resolve")):
    if not database.db_engine and not database.connect_to_database():
        raise HTTPException(status_code=503, detail="Database unavailable")

    with database.db_engine.connect() as conn:
        resolved = resolve_drug_name(conn, name)

    return {
        "name": name,
        "rxcui": resolved.get("rxcui"),
        "generic_name": resolved.get("generic_name"),
        "brand_names": resolved.get("brand_names") or [],
    }


@router.get("/api/interactions/{drug}", response_model=DrugInteractionsListResponse)
def list_interactions_for_drug(
    drug: str = Path(..., description="Drug name or brand name"),
    severity: Optional[str] = Query(None, description="Filter by severity: major, moderate, minor, unknown"),
    page: int = Query(1, ge=1, description="Page number (1-based)"),
    per_page: int = Query(20, ge=1, le=100, description="Results per page (max 100)"),
):
    """
    List all known drug interactions for a single drug.

    Results are ordered by severity (major → moderate → minor → unknown) then
    interacting drug name. The `severity_summary` field always reflects the full
    unfiltered counts regardless of the `severity` query parameter.
    """
    if severity is not None and severity not in _VALID_SEVERITIES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid severity '{severity}'. Must be one of: {sorted(_VALID_SEVERITIES)}",
        )

    if not database.db_engine and not database.connect_to_database():
        raise HTTPException(status_code=503, detail="Database unavailable")

    with database.db_engine.connect() as conn:
        resolved = resolve_drug_name(conn, drug)
        rxcui = resolved.get("rxcui")

        if not rxcui:
            raise HTTPException(
                status_code=404,
                detail=f"Could not resolve '{drug}' to a known drug. Check spelling or try the generic name.",
            )

        total, severity_summary, interactions = get_interactions_for_drug(
            conn, rxcui, severity=severity, page=page, per_page=per_page
        )

    return DrugInteractionsListResponse(
        drug=drug,
        rxcui=rxcui,
        generic_name=resolved.get("generic_name"),
        brand_names=resolved.get("brand_names") or [],
        total=total,
        page=page,
        per_page=per_page,
        severity_summary=SeveritySummary(**severity_summary),
        interactions=[DrugInteractionItem(**i) for i in interactions],
    )


@router.get("/api/interactions", response_model=InteractionResponse)
def get_interaction(
    drug1: str = Query(..., description="First drug name"),
    drug2: str = Query(..., description="Second drug name"),
):
    if not database.db_engine and not database.connect_to_database():
        raise HTTPException(status_code=503, detail="Database unavailable")

    with database.db_engine.begin() as conn:
        resolved_1 = resolve_drug_name(conn, drug1)
        resolved_2 = resolve_drug_name(conn, drug2)
        r1 = resolved_1.get("rxcui")
        r2 = resolved_2.get("rxcui")
        generic_1 = resolved_1.get("generic_name")
        generic_2 = resolved_2.get("generic_name")
        brands_1 = resolved_1.get("brand_names") or []
        brands_2 = resolved_2.get("brand_names") or []

        if not r1 or not r2:
            return InteractionResponse(
                drug1=drug1,
                drug2=drug2,
                drug1_generic=generic_1,
                drug2_generic=generic_2,
                drug1_brands=brands_1,
                drug2_brands=brands_2,
                drug1_rxcui=r1,
                drug2_rxcui=r2,
                severity=None,
                description=None,
                confidence=None,
                source_kaggle=False,
                source_openfda=False,
                found=False,
                message="No interaction data found",
            )

        pair = get_interaction_pair(conn, r1, r2)
        if not pair:
            return InteractionResponse(
                drug1=drug1,
                drug2=drug2,
                drug1_generic=generic_1,
                drug2_generic=generic_2,
                drug1_brands=brands_1,
                drug2_brands=brands_2,
                drug1_rxcui=r1,
                drug2_rxcui=r2,
                severity=None,
                description=None,
                confidence=None,
                source_kaggle=False,
                source_openfda=False,
                found=False,
                message="No interaction data found",
            )

        first_candidates = _candidate_names(resolved_2, drug2)
        second_candidates = _candidate_names(resolved_1, drug1)
        selected_description: Optional[str] = None
        selected_source: Optional[str] = None

        cached_candidates: list[tuple[str, str]] = []
        for rx, names in ((r1, first_candidates), (r2, second_candidates)):
            cached_text, cached_source = search_cached_label_text(conn, rx, names)
            if cached_text and cached_source:
                cached_candidates.append((cached_text, cached_source))

        for preferred_source in ("spl_professional", "openfda"):
            matched = next((item for item in cached_candidates if item[1] == preferred_source), None)
            if matched:
                selected_description, selected_source = matched
                break

        if not selected_description:
            try:
                source_name, live_text = fetch_openfda_interaction_text(r1, generic_1)
                if live_text and _text_matches_candidates(live_text, first_candidates):
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
                        {
                            "rxcui": r1,
                            "drug_name": source_name or drug1,
                            "interactions_text": live_text,
                        },
                    )
                    selected_description = live_text
                    selected_source = "openfda"
            except Exception as exc:
                logger.warning("Live OpenFDA fallback failed for (%s, %s): %s", drug1, drug2, exc)

        if not selected_description:
            try:
                source_name, live_text = fetch_openfda_interaction_text(r2, generic_2)
                if live_text and _text_matches_candidates(live_text, second_candidates):
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
                        {
                            "rxcui": r2,
                            "drug_name": source_name or drug2,
                            "interactions_text": live_text,
                        },
                    )
                    selected_description = live_text
                    selected_source = "openfda"
            except Exception as exc:
                logger.warning("Live OpenFDA fallback failed for (%s, %s): %s", drug1, drug2, exc)

        if selected_description and selected_source == "openfda":
            cache_low_confidence_interaction(conn, r1, r2, drug1, drug2, selected_description)

        return InteractionResponse(
            drug1=drug1,
            drug2=drug2,
            drug1_generic=generic_1,
            drug2_generic=generic_2,
            drug1_brands=brands_1,
            drug2_brands=brands_2,
            drug1_rxcui=r1,
            drug2_rxcui=r2,
            severity=pair.get("severity"),
            description=selected_description,
            confidence=pair.get("confidence"),
            source_kaggle=bool(pair.get("source_kaggle")),
            source_openfda=bool(pair.get("source_openfda") or selected_source == "openfda"),
            found=True,
            message=None,
        )
