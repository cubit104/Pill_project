from __future__ import annotations

import logging
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text

import database

logger = logging.getLogger(__name__)
router = APIRouter()

RXNORM_URL = "https://rxnav.nlm.nih.gov/REST/rxcui.json"
OPENFDA_URL = "https://api.fda.gov/drug/label.json"


class InteractionResponse(BaseModel):
    drug1: str
    drug2: str
    drug1_rxcui: Optional[str]
    drug2_rxcui: Optional[str]
    severity: Optional[str]
    description: Optional[str]
    confidence: Optional[str]
    source_kaggle: bool = False
    source_openfda: bool = False
    found: bool
    message: Optional[str] = None


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
            return str(rxnorm_ids[0]).strip()
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


def search_cached_label_text(conn, rxcui: str, counterpart_names: set[str]) -> Optional[str]:
    row = conn.execute(
        text("SELECT interactions_text FROM drug_interactions_text WHERE rxcui = :rxcui LIMIT 1"),
        {"rxcui": rxcui},
    ).fetchone()
    if not row or not row[0] or not counterpart_names:
        return None
    text_value = str(row[0])
    if _text_matches_candidates(text_value, counterpart_names):
        return text_value
    return None


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


def fetch_openfda_interaction_text(rxcui: str) -> tuple[str, str]:
    response = httpx.get(OPENFDA_URL, params={"search": f"openfda.rxcui:{rxcui}", "limit": 1}, timeout=12)
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

        if not r1 or not r2:
            return InteractionResponse(
                drug1=drug1,
                drug2=drug2,
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
        if pair:
            return InteractionResponse(
                drug1=drug1,
                drug2=drug2,
                drug1_rxcui=r1,
                drug2_rxcui=r2,
                severity=pair.get("severity"),
                description=pair.get("description"),
                confidence=pair.get("confidence"),
                source_kaggle=bool(pair.get("source_kaggle")),
                source_openfda=bool(pair.get("source_openfda")),
                found=True,
                message=None,
            )

        first_candidates = _candidate_names(resolved_2, drug2)
        second_candidates = _candidate_names(resolved_1, drug1)

        cached_text = search_cached_label_text(conn, r1, first_candidates)
        if cached_text:
            return InteractionResponse(
                drug1=drug1,
                drug2=drug2,
                drug1_rxcui=r1,
                drug2_rxcui=r2,
                severity=classify_severity(cached_text),
                description=cached_text,
                confidence="medium",
                source_kaggle=False,
                source_openfda=True,
                found=True,
                message=None,
            )
        cached_text = search_cached_label_text(conn, r2, second_candidates)
        if cached_text:
            return InteractionResponse(
                drug1=drug1,
                drug2=drug2,
                drug1_rxcui=r1,
                drug2_rxcui=r2,
                severity=classify_severity(cached_text),
                description=cached_text,
                confidence="medium",
                source_kaggle=False,
                source_openfda=True,
                found=True,
                message=None,
            )

        try:
            source_name, live_text = fetch_openfda_interaction_text(r1)
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
                cache_low_confidence_interaction(conn, r1, r2, drug1, drug2, live_text)
                return InteractionResponse(
                    drug1=drug1,
                    drug2=drug2,
                    drug1_rxcui=r1,
                    drug2_rxcui=r2,
                    severity=classify_severity(live_text),
                    description=live_text,
                    confidence="low",
                    source_kaggle=False,
                    source_openfda=True,
                    found=True,
                    message=None,
                )
            source_name, live_text = fetch_openfda_interaction_text(r2)
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
                cache_low_confidence_interaction(conn, r1, r2, drug1, drug2, live_text)
                return InteractionResponse(
                    drug1=drug1,
                    drug2=drug2,
                    drug1_rxcui=r1,
                    drug2_rxcui=r2,
                    severity=classify_severity(live_text),
                    description=live_text,
                    confidence="low",
                    source_kaggle=False,
                    source_openfda=True,
                    found=True,
                    message=None,
                )
        except Exception as exc:
            logger.warning("Live OpenFDA fallback failed for (%s, %s): %s", drug1, drug2, exc)

    return InteractionResponse(
        drug1=drug1,
        drug2=drug2,
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
