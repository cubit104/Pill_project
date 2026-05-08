"""Medication guide builder backed by openFDA + Supabase cache table."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import text

import database
from ndc_normalize import normalize_ndc_to_11
from services.openfda_client import OpenFDAClient, OpenFDAUpstreamError

logger = logging.getLogger(__name__)

CACHE_TTL_DAYS = 30
DISCLAIMER = (
    "This information is for educational purposes only and is not medical advice. "
    "Always consult a healthcare professional. Source: U.S. FDA Structured Product Labeling (openFDA)."
)


class GuideNotFoundError(RuntimeError):
    """Raised when no FDA label can be found for the requested drug."""


class GuideInternalError(RuntimeError):
    """Raised when database access fails for guide operations."""


SECTION_MAPPING: dict[str, tuple[str, ...]] = {
    "overview": ("description",),
    "uses": ("indications_and_usage",),
    "dosage": ("dosage_and_administration", "dosage_forms_and_strengths"),
    "how_to_take": ("information_for_patients", "spl_patient_package_insert", "instructions_for_use"),
    "side_effects": ("adverse_reactions",),
    "warnings": ("boxed_warning", "warnings_and_cautions", "warnings"),
    "interactions": ("drug_interactions",),
    "contraindications": ("contraindications",),
    "special_populations": ("pregnancy", "lactation", "pediatric_use", "geriatric_use", "use_in_specific_populations"),
    "overdose": ("overdosage",),
    "storage": ("storage_and_handling", "how_supplied"),
    "pharmacology": ("clinical_pharmacology", "mechanism_of_action", "pharmacokinetics"),
}

_GUIDE_COLUMNS = [
    "rxcui",
    "ndc",
    "spl_set_id",
    "generic_name",
    "brand_name",
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
    "has_boxed_warning",
    "source_url",
    "fetched_at",
]


def _first_str(value: Any) -> Optional[str]:
    """Return the first non-empty string from a list/string value."""
    if isinstance(value, list):
        for item in value:
            if isinstance(item, str) and item.strip():
                return item.strip()
        return None
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _paragraphs_from_field(payload: dict[str, Any], field: str) -> list[str]:
    """Extract non-empty text paragraphs from an openFDA label field."""
    value = payload.get(field)
    if not value:
        return []
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        if isinstance(item, str):
            stripped = item.strip()
            if stripped:
                out.append(stripped)
    return out


def _join_section(payload: dict[str, Any], fields: tuple[str, ...]) -> Optional[str]:
    """Join multiple openFDA fields into one section or return None."""
    paragraphs: list[str] = []
    for field in fields:
        paragraphs.extend(_paragraphs_from_field(payload, field))
    return "\n\n".join(paragraphs) if paragraphs else None


def _build_manufacturer(openfda: dict[str, Any]) -> Optional[str]:
    """Build the manufacturer section from openFDA metadata."""
    lines: list[str] = []
    manufacturer_name = _first_str(openfda.get("manufacturer_name"))
    product_ndc = _first_str(openfda.get("product_ndc"))
    spl_id = _first_str(openfda.get("spl_id"))

    if manufacturer_name:
        lines.append(f"Manufacturer: {manufacturer_name}")
    if product_ndc:
        lines.append(f"Product NDC: {product_ndc}")
    if spl_id:
        lines.append(f"SPL ID: {spl_id}")

    return "\n".join(lines) if lines else None


def _to_iso(value: Any) -> Optional[str]:
    """Convert DB timestamps to UTC ISO string format."""
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return str(value)


def _row_to_response(row: dict[str, Any]) -> dict[str, Any]:
    """Convert a medication_guide row dict into API response shape."""
    return {
        "rxcui": row.get("rxcui"),
        "ndc": row.get("ndc"),
        "generic_name": row.get("generic_name"),
        "brand_name": row.get("brand_name"),
        "has_boxed_warning": bool(row.get("has_boxed_warning")),
        "sections": {
            "overview": row.get("overview"),
            "uses": row.get("uses"),
            "dosage": row.get("dosage"),
            "how_to_take": row.get("how_to_take"),
            "side_effects": row.get("side_effects"),
            "warnings": row.get("warnings"),
            "interactions": row.get("interactions"),
            "contraindications": row.get("contraindications"),
            "special_populations": row.get("special_populations"),
            "overdose": row.get("overdose"),
            "storage": row.get("storage"),
            "pharmacology": row.get("pharmacology"),
            "manufacturer": row.get("manufacturer"),
        },
        "source_url": row.get("source_url"),
        "fetched_at": _to_iso(row.get("fetched_at")),
        "disclaimer": DISCLAIMER,
    }


def _is_stale(fetched_at: Any) -> bool:
    """Return True when fetched_at is older than the configured cache TTL."""
    if not isinstance(fetched_at, datetime):
        return True
    threshold = datetime.now(timezone.utc) - timedelta(days=CACHE_TTL_DAYS)
    dt = fetched_at if fetched_at.tzinfo else fetched_at.replace(tzinfo=timezone.utc)
    return dt < threshold


def _row_as_dict(keys: list[str], row: Any) -> dict[str, Any]:
    return dict(zip(keys, row))


def _select_cached_row(conn, *, rxcui: Optional[str], ndc: Optional[str]) -> Optional[dict[str, Any]]:
    """Load cached medication_guide row by rxcui or ndc."""
    if rxcui:
        row = conn.execute(
            text("SELECT * FROM public.medication_guide WHERE rxcui = :rxcui LIMIT 1"),
            {"rxcui": rxcui},
        ).fetchone()
        if row:
            return _row_as_dict(list(row._mapping.keys()), row)

    if ndc:
        clean_ndc = ndc.replace("-", "")
        row = conn.execute(
            text(
                """
                SELECT * FROM public.medication_guide
                WHERE ndc = :ndc OR REPLACE(COALESCE(ndc, ''), '-', '') = :clean_ndc
                LIMIT 1
                """
            ),
            {"ndc": ndc, "clean_ndc": clean_ndc},
        ).fetchone()
        if row:
            return _row_as_dict(list(row._mapping.keys()), row)

    return None


def _map_openfda_record(record: dict[str, Any], *, requested_rxcui: Optional[str]) -> dict[str, Any]:
    """Map one openFDA label record into medication_guide table columns."""
    openfda = record.get("openfda") or {}

    rxcui = _first_str(openfda.get("rxcui")) or requested_rxcui
    ndc = _first_str(openfda.get("product_ndc"))
    spl_set_id = _first_str(openfda.get("spl_set_id"))
    generic_name = _first_str(openfda.get("generic_name"))
    brand_name = _first_str(openfda.get("brand_name"))

    mapped: dict[str, Any] = {
        "rxcui": rxcui,
        "ndc": ndc,
        "spl_set_id": spl_set_id,
        "generic_name": generic_name,
        "brand_name": brand_name,
        "has_boxed_warning": bool(_paragraphs_from_field(record, "boxed_warning")),
    }

    for section_key, fields in SECTION_MAPPING.items():
        mapped[section_key] = _join_section(record, fields)

    mapped["manufacturer"] = _build_manufacturer(openfda)

    if spl_set_id:
        mapped["source_url"] = f"https://api.fda.gov/drug/label.json?search=spl_set_id:{spl_set_id}"
    elif rxcui:
        mapped["source_url"] = f"https://api.fda.gov/drug/label.json?search=openfda.rxcui:{rxcui}"
    else:
        mapped["source_url"] = None

    return mapped


def _upsert_guide(conn, payload: dict[str, Any], existing_id: Optional[int]) -> dict[str, Any]:
    """Insert or update one medication_guide row and return it."""
    payload = dict(payload)
    payload["updated_at"] = datetime.now(timezone.utc)
    payload["fetched_at"] = payload["updated_at"]

    if existing_id:
        assignments = ", ".join(f"{col} = :{col}" for col in payload.keys())
        params = {**payload, "id": existing_id}
        conn.execute(
            text(f"UPDATE public.medication_guide SET {assignments} WHERE id = :id"),
            params,
        )
        row = conn.execute(
            text("SELECT * FROM public.medication_guide WHERE id = :id LIMIT 1"),
            {"id": existing_id},
        ).fetchone()
        conn.commit()
        return _row_as_dict(list(row._mapping.keys()), row)

    cols = ", ".join(payload.keys())
    values = ", ".join(f":{col}" for col in payload.keys())
    row = conn.execute(
        text(f"INSERT INTO public.medication_guide ({cols}) VALUES ({values}) RETURNING *"),
        payload,
    ).fetchone()
    conn.commit()
    return _row_as_dict(list(row._mapping.keys()), row)


async def build_guide(
    *,
    rxcui: Optional[str] = None,
    ndc: Optional[str] = None,
    force_refresh: bool = False,
    openfda_client: Optional[OpenFDAClient] = None,
) -> dict[str, Any]:
    """Resolve, cache, and return a medication guide by RxCUI or NDC.

    Args:
        rxcui: Preferred lookup key.
        ndc: Fallback or primary lookup key when RxCUI is unavailable.
        force_refresh: If True, bypasses cache freshness checks.
        openfda_client: Optional injectable client for tests.

    Returns:
        API response payload for one medication guide.

    Raises:
        GuideNotFoundError: When openFDA has no label for the requested drug.
        OpenFDAUpstreamError: When openFDA fails after retries.
        GuideInternalError: When database is unavailable.
    """
    if not rxcui and not ndc:
        raise GuideNotFoundError("No FDA label found for this drug")

    normalized_ndc = normalize_ndc_to_11(ndc) if ndc else None

    if not database.db_engine and not database.connect_to_database():
        raise GuideInternalError("Database connection not available")

    client = openfda_client or OpenFDAClient()

    with database.db_engine.connect() as conn:
        cached = _select_cached_row(conn, rxcui=rxcui, ndc=normalized_ndc or ndc)
        if cached and not force_refresh and not _is_stale(cached.get("fetched_at")):
            logger.debug("Medication guide cache hit for rxcui=%s ndc=%s", rxcui, normalized_ndc or ndc)
            return _row_to_response(cached)

        logger.info(
            "Medication guide fetch from openFDA (cache %s) for rxcui=%s ndc=%s",
            "stale" if cached else "miss",
            rxcui,
            normalized_ndc or ndc,
        )

        label_record = None
        if rxcui:
            label_record = await client.fetch_label_by_rxcui(rxcui)

        if label_record is None and (normalized_ndc or ndc):
            ndc_query = normalized_ndc or ndc
            label_record = await client.fetch_label_by_ndc(ndc_query)

        if label_record is None:
            raise GuideNotFoundError("No FDA label found for this drug")

        mapped = _map_openfda_record(label_record, requested_rxcui=rxcui)
        existing_id = int(cached["id"]) if cached and cached.get("id") is not None else None
        if existing_id is None:
            existing = _select_cached_row(conn, rxcui=mapped.get("rxcui"), ndc=mapped.get("ndc"))
            existing_id = int(existing["id"]) if existing and existing.get("id") is not None else None

        row = _upsert_guide(conn, mapped, existing_id=existing_id)
        return _row_to_response(row)
