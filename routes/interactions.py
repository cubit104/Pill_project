from __future__ import annotations

import logging
from typing import Optional

import httpx
from fastapi import APIRouter, Body, HTTPException, Path, Query
from pydantic import BaseModel
from sqlalchemy import bindparam, text

import database
from services.interaction_spl_extract import extract_targeted_paragraph

logger = logging.getLogger(__name__)
router = APIRouter()

RXNORM_URL = "https://rxnav.nlm.nih.gov/REST/rxcui.json"
OPENFDA_URL = "https://api.fda.gov/drug/label.json"
_VALID_SEVERITIES = frozenset({"major", "moderate", "minor", "unknown"})
_FALLBACK_DESCRIPTION = "Interaction identified in clinical drug databases. Consult your pharmacist or prescriber before use."


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
    spl_text: Optional[str] = None
    reference_text: Optional[str] = None
    management: Optional[str] = None
    confidence: Optional[str]
    source_kaggle: bool = False
    source_openfda: bool = False
    source_ddinter: bool = False
    found: bool
    message: Optional[str] = None


class DrugInteractionItem(BaseModel):
    drug_name: str
    rxcui: Optional[str]
    severity: Optional[str]
    description: Optional[str]
    management: Optional[str] = None
    confidence: Optional[str]
    source_kaggle: bool = False
    source_openfda: bool = False
    source_ddinter: bool = False


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


class InteractionCheckRequest(BaseModel):
    drugs: list[str]


class DrugFoodInteractionItem(BaseModel):
    selected_drug: str
    matched_drug_name: str
    food_name: str
    level: str = "unknown"
    interaction: Optional[str] = None
    management: Optional[str] = None
    ref_text: Optional[str] = None
    source_ddinter: bool = True


class DrugDiseaseInteractionItem(BaseModel):
    selected_drug: str
    matched_drug_name: str
    disease_name: str
    level: str = "unknown"
    text: Optional[str] = None
    ref_text: Optional[str] = None
    source_ddinter: bool = True


class InteractionBatchSections(BaseModel):
    drug_drug: int = 0
    drug_food: int = 0
    drug_disease: int = 0
    food_truncated: bool = False
    disease_truncated: bool = False


class InteractionBatchSummary(BaseModel):
    severity: SeveritySummary
    sections: InteractionBatchSections


class InteractionCheckResponse(BaseModel):
    drugs: list[str]
    pairs: list[InteractionResponse]
    food_interactions: list[DrugFoodInteractionItem]
    disease_interactions: list[DrugDiseaseInteractionItem]
    summary: InteractionBatchSummary


def classify_severity(text_value: str) -> str:
    text_value = (text_value or "").lower()
    if any(w in text_value for w in ["contraindicated", "do not use", "life-threatening", "fatal", "serious risk", "avoid combination"]):
        return "major"
    elif any(w in text_value for w in ["avoid", "serious", "significant", "monitor closely", "caution", "reduce dose", "closely monitor"]):
        return "moderate"
    elif any(w in text_value for w in ["minor", "minimal", "slight", "unlikely"]):
        return "minor"
    return "unknown"


def normalize_severity(value: Optional[str]) -> str:
    lowered = (value or "").strip().lower()
    if lowered in _VALID_SEVERITIES:
        return lowered
    if lowered in {"contraindicated", "high"}:
        return "major"
    if lowered in {"medium"}:
        return "moderate"
    if lowered in {"low"}:
        return "minor"
    # Numeric text levels from drug_food_interactions / drug_disease_interactions
    if lowered == "3":
        return "major"
    if lowered == "2":
        return "moderate"
    if lowered == "1":
        return "minor"
    return "unknown"


def canonical_pair(rxcui_1: str, rxcui_2: str, drug_1: str, drug_2: str) -> tuple[str, str, str, str]:
    if rxcui_1 <= rxcui_2:
        return rxcui_1, rxcui_2, drug_1, drug_2
    return rxcui_2, rxcui_1, drug_2, drug_1


def _resolve_to_ingredient_rxcui(rxcui: str) -> str:
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


_SEVERITY_RANK: dict[str, int] = {"major": 0, "moderate": 1, "minor": 2, "unknown": 3}


def get_interaction_pair(conn, rxcui_1: str, rxcui_2: str) -> Optional[dict]:
    if not rxcui_1 or not rxcui_2:
        return None
    r1, r2 = str(rxcui_1), str(rxcui_2)
    rows = conn.execute(
        text(
            """
            SELECT rxcui_1, rxcui_2, drug_name_1, drug_name_2, description, severity, confidence,
                   source_kaggle, source_openfda, source_ddinter, management
            FROM drug_interactions
            WHERE (rxcui_1 = :r1 AND rxcui_2 = :r2)
               OR (rxcui_1 = :r2 AND rxcui_2 = :r1)
            """
        ),
        {"r1": r1, "r2": r2},
    ).fetchall()
    if not rows:
        return None

    # Single-row fast path — identical to old behaviour
    if len(rows) == 1:
        row = rows[0]
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
            "source_ddinter": bool(row[9]),
            "management": row[10],
        }

    # Multi-row merge with field-level precedence
    parsed: list[dict] = []
    for row in rows:
        parsed.append(
            {
                "rxcui_1": row[0],
                "rxcui_2": row[1],
                "drug_name_1": row[2],
                "drug_name_2": row[3],
                "description": (row[4] or "").strip() or None,
                "severity": normalize_severity(row[5]),
                "confidence": row[6],
                "source_kaggle": bool(row[7]),
                "source_openfda": bool(row[8]),
                "source_ddinter": bool(row[9]),
                "management": (row[10] or "").strip() or None,
            }
        )

    ddinter_rows = [p for p in parsed if p["source_ddinter"]]
    kaggle_rows = [p for p in parsed if p["source_kaggle"]]

    # Pick the best DDInter severity (most severe non-unknown)
    best_severity = "unknown"
    for p in ddinter_rows:
        sev = p["severity"]
        if _SEVERITY_RANK.get(sev, 3) < _SEVERITY_RANK.get(best_severity, 3):
            best_severity = sev
    if best_severity == "unknown":
        # Fall back to Kaggle severity
        for p in kaggle_rows:
            sev = p["severity"]
            if _SEVERITY_RANK.get(sev, 3) < _SEVERITY_RANK.get(best_severity, 3):
                best_severity = sev
    if best_severity == "unknown":
        # Last resort: any row
        for p in parsed:
            sev = p["severity"]
            if _SEVERITY_RANK.get(sev, 3) < _SEVERITY_RANK.get(best_severity, 3):
                best_severity = sev

    # description: prefer Kaggle non-empty; fallback to any non-empty
    description: Optional[str] = None
    for p in kaggle_rows:
        if p["description"]:
            description = p["description"]
            break
    if not description:
        for p in parsed:
            if p["description"]:
                description = p["description"]
                break

    # management: from DDInter row
    management: Optional[str] = None
    for p in ddinter_rows:
        if p["management"]:
            management = p["management"]
            break

    any_ddinter = any(p["source_ddinter"] for p in parsed)
    confidence = "high" if any_ddinter else (parsed[0]["confidence"] if parsed else None)

    base = parsed[0]
    return {
        "rxcui_1": base["rxcui_1"],
        "rxcui_2": base["rxcui_2"],
        "drug_name_1": base["drug_name_1"],
        "drug_name_2": base["drug_name_2"],
        "description": description,
        "severity": best_severity,
        "confidence": confidence,
        "source_kaggle": any(p["source_kaggle"] for p in parsed),
        "source_openfda": any(p["source_openfda"] for p in parsed),
        "source_ddinter": any_ddinter,
        "management": management,
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

    # Always try targeted extraction regardless of source —
    # openfda and spl_professional store the same FDA label text
    targeted = extract_targeted_paragraph(text_value, counterpart_names)
    if targeted:
        return targeted, source
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


def _clean_drug_inputs(drugs: list[str], max_items: int = 10) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for item in drugs:
        value = (item or "").strip()
        if not value:
            continue
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(value)
        if len(cleaned) >= max_items:
            break
    return cleaned


def _pair_interaction_from_resolved(
    conn,
    drug1: str,
    drug2: str,
    resolved_1: dict,
    resolved_2: dict,
    allow_live_openfda: bool = True,
) -> InteractionResponse:
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
            spl_text=None,
            reference_text=None,
            management=None,
            confidence=None,
            source_kaggle=False,
            source_openfda=False,
            source_ddinter=False,
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
            spl_text=None,
            reference_text=None,
            management=None,
            confidence=None,
            source_kaggle=False,
            source_openfda=False,
            source_ddinter=False,
            found=False,
            message="No interaction data found",
        )

    pair_description: Optional[str] = (pair.get("description") or "").strip() or None

    first_candidates = _candidate_names(resolved_2, drug2)
    second_candidates = _candidate_names(resolved_1, drug1)
    selected_spl_text: Optional[str] = None
    selected_source: Optional[str] = None

    cached_candidates: list[tuple[str, str]] = []
    for rx, names in ((r1, first_candidates), (r2, second_candidates)):
        cached_text, cached_source = search_cached_label_text(conn, rx, names)
        if cached_text and cached_source:
            cached_candidates.append((cached_text, cached_source))

    for preferred_source in ("spl_professional", "openfda"):
        matched = next((item for item in cached_candidates if item[1] == preferred_source), None)
        if matched:
            selected_spl_text, selected_source = matched
            break
    if not selected_spl_text and cached_candidates:
        selected_spl_text, selected_source = cached_candidates[0]

    if not selected_spl_text and allow_live_openfda:
        for rx, generic, names, drug_label in (
            (r1, generic_1, first_candidates, drug1),
            (r2, generic_2, second_candidates, drug2),
        ):
            try:
                source_name, live_text = fetch_openfda_interaction_text(rx, generic)
                if live_text and _text_matches_candidates(live_text, names):
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
                        {"rxcui": rx, "drug_name": source_name or drug_label, "interactions_text": live_text},
                    )
                    selected_spl_text = live_text
                    selected_source = "openfda"
                    break
            except Exception as exc:
                logger.warning("Live OpenFDA fallback failed for (%s, %s): %s", drug1, drug2, exc)

    source_ddinter = bool(pair.get("source_ddinter"))
    confidence = "high" if source_ddinter else pair.get("confidence")
    severity = normalize_severity(pair.get("severity"))
    management = (pair.get("management") or "").strip() or None
    description_out = pair_description or selected_spl_text or _FALLBACK_DESCRIPTION

    return InteractionResponse(
        drug1=drug1,
        drug2=drug2,
        drug1_generic=generic_1,
        drug2_generic=generic_2,
        drug1_brands=brands_1,
        drug2_brands=brands_2,
        drug1_rxcui=r1,
        drug2_rxcui=r2,
        severity=severity,
        description=description_out,
        spl_text=selected_spl_text,
        reference_text=selected_spl_text,
        management=management,
        confidence=confidence,
        source_kaggle=bool(pair.get("source_kaggle")),
        # spl_professional stores the same FDA label text as openfda, so treat both as an OpenFDA source
        source_openfda=bool(pair.get("source_openfda") or selected_source in ("openfda", "spl_professional")),
        source_ddinter=source_ddinter,
        found=True,
        message=None,
    )


_FOOD_DISEASE_CAP = 100


def _fetch_drug_food_interactions(conn, resolved_map: dict[str, dict]) -> list[dict]:
    candidate_map = {drug: _candidate_names(resolved, drug) for drug, resolved in resolved_map.items()}
    all_candidates = sorted({name for values in candidate_map.values() for name in values})
    if not all_candidates:
        return []

    sql = text(
        """
        SELECT drug_name, food_name, level, interaction, management, ref_text
        FROM drug_food_interactions
        WHERE LOWER(drug_name) IN :candidate_names
        ORDER BY drug_name, food_name
        """
    ).bindparams(bindparam("candidate_names", expanding=True))
    rows = conn.execute(sql, {"candidate_names": all_candidates}).fetchall()

    # Collect raw items with (selected_drug, food_name_lower) grouping
    best: dict[tuple[str, str], dict] = {}
    for row in rows:
        matched_name = (row[0] or "").strip()
        if not matched_name:
            continue
        lowered = matched_name.lower()
        food_name = row[1] or ""
        food_key = food_name.lower()
        level = normalize_severity(row[2])
        interaction = row[3]
        for selected_drug, names in candidate_map.items():
            if lowered in names:
                key = (selected_drug, food_key)
                candidate = {
                    "selected_drug": selected_drug,
                    "matched_drug_name": matched_name,
                    "food_name": food_name,
                    "level": level,
                    "interaction": interaction,
                    "management": row[4],
                    "ref_text": row[5],
                    "source_ddinter": True,
                }
                existing = best.get(key)
                if existing is None:
                    best[key] = candidate
                else:
                    existing_rank = _SEVERITY_RANK.get(existing["level"], 3)
                    new_rank = _SEVERITY_RANK.get(level, 3)
                    if new_rank < existing_rank or (
                        new_rank == existing_rank
                        and len(interaction or "") > len(existing["interaction"] or "")
                    ):
                        best[key] = candidate

    items = list(best.values())
    # Sort by severity rank, then food name
    items.sort(key=lambda x: (_SEVERITY_RANK.get(x["level"], 3), x["food_name"].lower()))
    return items


def _fetch_drug_disease_interactions(conn, resolved_map: dict[str, dict]) -> list[dict]:
    candidate_map = {drug: _candidate_names(resolved, drug) for drug, resolved in resolved_map.items()}
    all_candidates = sorted({name for values in candidate_map.values() for name in values})
    if not all_candidates:
        return []

    sql = text(
        """
        SELECT drug_name, disease_name, level, text, ref_text
        FROM drug_disease_interactions
        WHERE LOWER(drug_name) IN :candidate_names
        ORDER BY drug_name, disease_name
        """
    ).bindparams(bindparam("candidate_names", expanding=True))
    rows = conn.execute(sql, {"candidate_names": all_candidates}).fetchall()

    best: dict[tuple[str, str], dict] = {}
    for row in rows:
        matched_name = (row[0] or "").strip()
        if not matched_name:
            continue
        lowered = matched_name.lower()
        disease_name = row[1] or ""
        disease_key = disease_name.lower()
        level = normalize_severity(row[2])
        text_val = row[3]
        for selected_drug, names in candidate_map.items():
            if lowered in names:
                key = (selected_drug, disease_key)
                candidate = {
                    "selected_drug": selected_drug,
                    "matched_drug_name": matched_name,
                    "disease_name": disease_name,
                    "level": level,
                    "text": text_val,
                    "ref_text": row[4],
                    "source_ddinter": True,
                }
                existing = best.get(key)
                if existing is None:
                    best[key] = candidate
                else:
                    existing_rank = _SEVERITY_RANK.get(existing["level"], 3)
                    new_rank = _SEVERITY_RANK.get(level, 3)
                    if new_rank < existing_rank or (
                        new_rank == existing_rank
                        and len(text_val or "") > len(existing["text"] or "")
                    ):
                        best[key] = candidate

    items = list(best.values())
    # Sort by severity rank, then disease name
    items.sort(key=lambda x: (_SEVERITY_RANK.get(x["level"], 3), x["disease_name"].lower()))
    return items


def fetch_openfda_interaction_text(rxcui: str, generic_name: Optional[str]) -> tuple[str, str]:
    generic = (generic_name or "").strip()
    if not generic:
        return "", ""
    escaped_generic = generic.replace('"', '\\"')
    response = httpx.get(
        OPENFDA_URL,
        params={"search": f'openfda.generic_name:"{escaped_generic}"', "limit": 1},
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


def cache_new_pair_only(conn, rxcui_1: str, rxcui_2: str, drug_1: str, drug_2: str, description: str) -> None:
    """Only insert brand-new pairs. Never update existing rows — Kaggle descriptions are protected."""
    r1, r2, n1, n2 = canonical_pair(rxcui_1, rxcui_2, drug_1, drug_2)
    conn.execute(
        text(
            """
            INSERT INTO drug_interactions
                (rxcui_1, rxcui_2, drug_name_1, drug_name_2, description, severity, confidence, source_kaggle, source_openfda, updated_at)
            VALUES
                (:r1, :r2, :n1, :n2, :description, :severity, 'low', FALSE, TRUE, NOW())
            ON CONFLICT (rxcui_1, rxcui_2) DO NOTHING
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


# Compatibility shim for the old helper name; behavior follows cache_new_pair_only.
cache_low_confidence_interaction = cache_new_pair_only


def get_interactions_for_drug(
    conn,
    rxcui: str,
    severity: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
) -> tuple[int, dict, list[dict]]:
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
    count_row = conn.execute(text(count_sql), base_params).fetchone()
    total = int(count_row[0]) if count_row else 0

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
            management,
            confidence,
            source_kaggle,
            source_openfda,
            source_ddinter
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
    result_rows = conn.execute(text(interactions_sql), paginated_params).fetchall()

    interactions = [
        {
            "drug_name": row[1] or "",
            "rxcui": row[0],
            "severity": row[2],
            "description": row[3],
            "management": row[4],
            "confidence": "high" if bool(row[8]) else row[5],
            "source_kaggle": bool(row[6]),
            "source_openfda": bool(row[7]),
            "source_ddinter": bool(row[8]),
        }
        for row in result_rows
    ]
    return total, severity_summary, interactions


@router.get("/api/interactions/suggestions")
def get_interaction_drug_suggestions(
    q: str = Query(..., min_length=1),
    limit: int = Query(10, ge=1, le=20),
):
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
def resolve_interaction_name(name: str = Query(...)):
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
    drug: str = Path(...),
    severity: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
):
    if severity is not None and severity not in _VALID_SEVERITIES:
        raise HTTPException(status_code=422, detail=f"Invalid severity '{severity}'.")

    if not database.db_engine and not database.connect_to_database():
        raise HTTPException(status_code=503, detail="Database unavailable")

    with database.db_engine.connect() as conn:
        resolved = resolve_drug_name(conn, drug)
        rxcui = resolved.get("rxcui")

        if not rxcui:
            raise HTTPException(status_code=404, detail=f"Could not resolve '{drug}'.")

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
    drug1: str = Query(...),
    drug2: str = Query(...),
):
    if not database.db_engine and not database.connect_to_database():
        raise HTTPException(status_code=503, detail="Database unavailable")

    with database.db_engine.begin() as conn:
        resolved_1 = resolve_drug_name(conn, drug1)
        resolved_2 = resolve_drug_name(conn, drug2)
        return _pair_interaction_from_resolved(conn, drug1, drug2, resolved_1, resolved_2)


@router.post("/api/interactions/check", response_model=InteractionCheckResponse)
def check_interactions_batch(payload: InteractionCheckRequest = Body(...)):
    if not database.db_engine and not database.connect_to_database():
        raise HTTPException(status_code=503, detail="Database unavailable")

    drugs = _clean_drug_inputs(payload.drugs or [], max_items=10)
    if len(drugs) < 2:
        raise HTTPException(status_code=422, detail="At least 2 unique drugs are required.")

    with database.db_engine.begin() as conn:
        resolved_map = {drug: resolve_drug_name(conn, drug) for drug in drugs}

        pairs: list[InteractionResponse] = []
        for i in range(len(drugs)):
            for j in range(i + 1, len(drugs)):
                drug1 = drugs[i]
                drug2 = drugs[j]
                pairs.append(
                    _pair_interaction_from_resolved(
                        conn,
                        drug1,
                        drug2,
                        resolved_map.get(drug1) or {},
                        resolved_map.get(drug2) or {},
                        allow_live_openfda=False,
                    )
                )

        food_items = _fetch_drug_food_interactions(conn, resolved_map)
        disease_items = _fetch_drug_disease_interactions(conn, resolved_map)

    severity_summary = {"major": 0, "moderate": 0, "minor": 0, "unknown": 0}
    pair_found_count = 0
    for item in pairs:
        if item.found:
            pair_found_count += 1
            severity_key = normalize_severity(item.severity if item.severity is not None else "unknown")
            severity_summary[severity_key] += 1

    true_food_total = len(food_items)
    true_disease_total = len(disease_items)
    food_truncated = true_food_total > _FOOD_DISEASE_CAP
    disease_truncated = true_disease_total > _FOOD_DISEASE_CAP

    return InteractionCheckResponse(
        drugs=drugs,
        pairs=pairs,
        food_interactions=[DrugFoodInteractionItem(**item) for item in food_items[:_FOOD_DISEASE_CAP]],
        disease_interactions=[DrugDiseaseInteractionItem(**item) for item in disease_items[:_FOOD_DISEASE_CAP]],
        summary=InteractionBatchSummary(
            severity=SeveritySummary(**severity_summary),
            sections=InteractionBatchSections(
                drug_drug=pair_found_count,
                drug_food=true_food_total,
                drug_disease=true_disease_total,
                food_truncated=food_truncated,
                disease_truncated=disease_truncated,
            ),
        ),
    )
