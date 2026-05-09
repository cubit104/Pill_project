import inspect
import logging
import re
from datetime import datetime, timezone
from html import escape
from typing import Any, Dict, Optional

import httpx
from fastapi import APIRouter, HTTPException, Query
from lxml import etree
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

import database
from services.spl_professional import fetch_professional_html

logger = logging.getLogger(__name__)
router = APIRouter()

_DAILYMED_SPL_XML_URL = "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/{spl_set_id}.xml"

_SECTION_ORDER = [
    "overview",
    "uses",
    "dosage",
    "how_to_take",
    "side_effects",
    "warnings",
    "interactions",
    "contraindications",
    "special_populations",
    "overdose",
    "storage",
    "pharmacology",
    "manufacturer",
]

_LOINC_TO_SECTION = {
    "34066-1": "warnings",  # Boxed warning
    "34067-9": "uses",
    "43685-7": "uses",
    "34068-7": "dosage",
    "42232-9": "special_populations",
    "34071-1": "contraindications",
    "34073-7": "interactions",
    "34084-4": "side_effects",
    "34076-0": "warnings",
    "34088-5": "overdose",
    "34089-3": "overdose",
    "34093-5": "pharmacology",
    "43678-2": "how_to_take",
    "34090-1": "overview",
    "34087-7": "manufacturer",
    "34092-7": "storage",
}

_TITLE_TO_SECTION = [
    ("overview", "overview"),
    ("indication", "uses"),
    ("usage", "uses"),
    ("dosage", "dosage"),
    ("administration", "how_to_take"),
    ("adverse", "side_effects"),
    ("side effect", "side_effects"),
    ("warning", "warnings"),
    ("precaution", "warnings"),
    ("interaction", "interactions"),
    ("contraindication", "contraindications"),
    ("specific population", "special_populations"),
    ("pregnancy", "special_populations"),
    ("lactation", "special_populations"),
    ("overdos", "overdose"),
    ("storage", "storage"),
    ("supplied", "storage"),
    ("pharmacology", "pharmacology"),
    ("manufacturer", "manufacturer"),
]

try:
    from services.dailymed_spl_client import fetch_spl_sections as _external_fetch_spl_sections
except Exception:
    _external_fetch_spl_sections = None


def _to_iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat()
    return str(value)


def _is_missing_dmg_table(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "drug_medication_guides" in msg and (
        "does not exist" in msg or "undefined table" in msg or "no such table" in msg
    )


def _empty_sections() -> Dict[str, Optional[str]]:
    return {key: None for key in _SECTION_ORDER}


def _normalize_sections(raw: Optional[Dict[str, Any]]) -> Dict[str, Optional[str]]:
    out = _empty_sections()
    if not isinstance(raw, dict):
        return out
    for key in _SECTION_ORDER:
        value = raw.get(key)
        out[key] = value if isinstance(value, str) and value.strip() else None
    return out


def _section_inner_html(section: etree._Element) -> str:
    parts = []
    if section.text and section.text.strip():
        parts.append(f"<p>{escape(section.text.strip())}</p>")
    for child in section:
        parts.append(etree.tostring(child, method="html", encoding="unicode"))
    return "".join(parts).strip()


def _pick_section_key(section: etree._Element) -> Optional[str]:
    codes = section.xpath(
        "./*[local-name()='code']/@code | ./*[local-name()='code']/*[local-name()='translation']/@code"
    )
    for code in codes:
        key = _LOINC_TO_SECTION.get(str(code).strip())
        if key:
            return key

    title = section.find("./{*}title")
    title_text = " ".join(title.itertext()).strip().lower() if title is not None else ""
    for needle, key in _TITLE_TO_SECTION:
        if needle in title_text:
            return key
    return None


async def _fetch_spl_sections_inline(spl_set_id: str) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "sections": _empty_sections(),
        "has_boxed_warning": False,
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(_DAILYMED_SPL_XML_URL.format(spl_set_id=spl_set_id))
        if response.status_code >= 400:
            return out

        parser = etree.XMLParser(recover=True)
        root = etree.fromstring(response.content, parser=parser)
        for section in root.xpath("//*[local-name()='section']"):
            key = _pick_section_key(section)
            if not key:
                continue

            codes = section.xpath(
                "./*[local-name()='code']/@code | ./*[local-name()='code']/*[local-name()='translation']/@code"
            )
            if "34066-1" in {str(c).strip() for c in codes}:
                out["has_boxed_warning"] = True

            section_html = _section_inner_html(section)
            if not section_html:
                continue

            existing = out["sections"].get(key)
            out["sections"][key] = f"{existing}\n<hr>\n{section_html}" if existing else section_html
    except Exception:
        logger.warning("Failed inline SPL section fetch for spl_set_id=%s", spl_set_id, exc_info=True)

    return out


async def _fetch_spl_sections(spl_set_id: str) -> Dict[str, Any]:
    if _external_fetch_spl_sections is not None:
        try:
            result = _external_fetch_spl_sections(spl_set_id)
            if inspect.isawaitable(result):
                result = await result
            if isinstance(result, dict):
                sections = _normalize_sections(result.get("sections", result))
                return {
                    "sections": sections,
                    "has_boxed_warning": bool(result.get("has_boxed_warning", False)),
                }
        except Exception:
            logger.warning("External SPL section fetch failed for spl_set_id=%s", spl_set_id, exc_info=True)

    return await _fetch_spl_sections_inline(spl_set_id)


def _build_response(
    pill_row: Dict[str, Any],
    guide_row: Dict[str, Any],
    include_professional: bool,
) -> Dict[str, Any]:
    sections = {
        key: guide_row.get(key)
        for key in _SECTION_ORDER
    }
    return {
        "rxcui": pill_row.get("rxcui"),
        "ndc": pill_row.get("ndc11") or pill_row.get("ndc9") or guide_row.get("ndc"),
        "generic_name": guide_row.get("generic_name") or pill_row.get("medicine_name"),
        "brand_name": guide_row.get("brand_name"),
        "has_boxed_warning": bool(guide_row.get("has_boxed_warning", False)),
        "sections": sections,
        "professional_html": guide_row.get("professional_html") if include_professional else None,
        "source_url": guide_row.get("source_url"),
        "fetched_at": _to_iso(guide_row.get("fetched_at")),
        "disclaimer": guide_row.get("disclaimer"),
    }


async def _get_guide_by_rxcui(rxcui: str, include_professional: bool) -> Dict[str, Any]:
    if not database.db_engine and not database.connect_to_database():
        raise HTTPException(status_code=503, detail="Database connection not available")

    try:
        with database.db_engine.connect() as conn:
            pill_result = conn.execute(
                text(
                    """
                    SELECT rxcui, ndc11, ndc9, medicine_name, spl_set_id
                    FROM pillfinder
                    WHERE deleted_at IS NULL AND rxcui = :rxcui
                    LIMIT 1
                    """
                ),
                {"rxcui": rxcui},
            )
            pill_row = pill_result.mappings().first()
            if not pill_row:
                raise HTTPException(status_code=404, detail="Drug not found")

            try:
                cache_result = conn.execute(
                    text(
                        """
                        SELECT *
                        FROM drug_medication_guides
                        WHERE rxcui = :rxcui
                          AND fetched_at > NOW() - INTERVAL '30 days'
                        ORDER BY fetched_at DESC
                        LIMIT 1
                        """
                    ),
                    {"rxcui": rxcui},
                )
                cache_row = cache_result.mappings().first()
            except SQLAlchemyError as exc:
                if _is_missing_dmg_table(exc):
                    raise HTTPException(
                        status_code=503,
                        detail="Medication guide cache table is unavailable. Please run DB migrations.",
                    )
                raise

            if cache_row:
                return _build_response(dict(pill_row), dict(cache_row), include_professional)

            spl_set_id = (pill_row.get("spl_set_id") or "").strip()
            sections_data = {"sections": _empty_sections(), "has_boxed_warning": False}
            professional_html = None
            source_url = None
            if spl_set_id:
                sections_data = await _fetch_spl_sections(spl_set_id)
                if include_professional:
                    professional_html = await fetch_professional_html(spl_set_id)
                source_url = f"https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid={spl_set_id}"

            sections = _normalize_sections(sections_data.get("sections"))
            disclaimer = "Source: FDA Structured Product Labeling via DailyMed"
            upsert_result = conn.execute(
                text(
                    """
                    INSERT INTO drug_medication_guides (
                        rxcui, ndc, spl_set_id, generic_name, brand_name, has_boxed_warning,
                        overview, uses, dosage, how_to_take, side_effects, warnings,
                        interactions, contraindications, special_populations, overdose,
                        storage, pharmacology, manufacturer, source_url, disclaimer,
                        professional_html, fetched_at
                    ) VALUES (
                        :rxcui, :ndc, :spl_set_id, :generic_name, :brand_name, :has_boxed_warning,
                        :overview, :uses, :dosage, :how_to_take, :side_effects, :warnings,
                        :interactions, :contraindications, :special_populations, :overdose,
                        :storage, :pharmacology, :manufacturer, :source_url, :disclaimer,
                        :professional_html, NOW()
                    )
                    ON CONFLICT (rxcui) DO UPDATE SET
                        ndc = EXCLUDED.ndc,
                        spl_set_id = EXCLUDED.spl_set_id,
                        generic_name = EXCLUDED.generic_name,
                        brand_name = COALESCE(EXCLUDED.brand_name, drug_medication_guides.brand_name),
                        has_boxed_warning = EXCLUDED.has_boxed_warning,
                        overview = EXCLUDED.overview,
                        uses = EXCLUDED.uses,
                        dosage = EXCLUDED.dosage,
                        how_to_take = EXCLUDED.how_to_take,
                        side_effects = EXCLUDED.side_effects,
                        warnings = EXCLUDED.warnings,
                        interactions = EXCLUDED.interactions,
                        contraindications = EXCLUDED.contraindications,
                        special_populations = EXCLUDED.special_populations,
                        overdose = EXCLUDED.overdose,
                        storage = EXCLUDED.storage,
                        pharmacology = EXCLUDED.pharmacology,
                        manufacturer = EXCLUDED.manufacturer,
                        source_url = EXCLUDED.source_url,
                        disclaimer = EXCLUDED.disclaimer,
                        professional_html = COALESCE(EXCLUDED.professional_html, drug_medication_guides.professional_html),
                        fetched_at = NOW()
                    RETURNING *
                    """
                ),
                {
                    "rxcui": pill_row.get("rxcui"),
                    "ndc": pill_row.get("ndc11") or pill_row.get("ndc9"),
                    "spl_set_id": spl_set_id or None,
                    "generic_name": pill_row.get("medicine_name"),
                    "brand_name": None,
                    "has_boxed_warning": bool(sections_data.get("has_boxed_warning", False)),
                    "overview": sections.get("overview"),
                    "uses": sections.get("uses"),
                    "dosage": sections.get("dosage"),
                    "how_to_take": sections.get("how_to_take"),
                    "side_effects": sections.get("side_effects"),
                    "warnings": sections.get("warnings"),
                    "interactions": sections.get("interactions"),
                    "contraindications": sections.get("contraindications"),
                    "special_populations": sections.get("special_populations"),
                    "overdose": sections.get("overdose"),
                    "storage": sections.get("storage"),
                    "pharmacology": sections.get("pharmacology"),
                    "manufacturer": sections.get("manufacturer"),
                    "source_url": source_url,
                    "disclaimer": disclaimer,
                    "professional_html": professional_html,
                },
            )
            conn.commit()
            saved_row = upsert_result.mappings().first() or {}
            return _build_response(dict(pill_row), dict(saved_row), include_professional)

    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        if _is_missing_dmg_table(exc):
            raise HTTPException(
                status_code=503,
                detail="Medication guide cache table is unavailable. Please run DB migrations.",
            )
        logger.error("Medication guide DB error for rxcui=%s: %s", rxcui, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Database error")
    except Exception as exc:
        logger.error("Medication guide fetch failed for rxcui=%s: %s", rxcui, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/api/drugs/{rxcui}/guide")
async def get_medication_guide(rxcui: str, include_professional: bool = Query(True)):
    return await _get_guide_by_rxcui(rxcui, include_professional)


@router.get("/api/drugs/by-ndc/{ndc}/guide")
async def get_medication_guide_by_ndc(ndc: str, include_professional: bool = Query(True)):
    if not database.db_engine and not database.connect_to_database():
        raise HTTPException(status_code=503, detail="Database connection not available")

    clean_ndc = re.sub(r"[^0-9]", "", ndc or "")

    try:
        with database.db_engine.connect() as conn:
            result = conn.execute(
                text(
                    """
                    SELECT rxcui
                    FROM pillfinder
                    WHERE deleted_at IS NULL
                      AND (
                        ndc11 = :ndc
                        OR ndc9 = :ndc
                        OR REPLACE(ndc11, '-', '') = :clean_ndc
                        OR REPLACE(ndc9, '-', '') = :clean_ndc
                      )
                    LIMIT 1
                    """
                ),
                {"ndc": ndc, "clean_ndc": clean_ndc},
            )
            row = result.mappings().first()

        if not row or not row.get("rxcui"):
            raise HTTPException(status_code=404, detail="Drug not found")

        return await _get_guide_by_rxcui(str(row["rxcui"]), include_professional)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Medication guide NDC lookup failed for ndc=%s: %s", ndc, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
