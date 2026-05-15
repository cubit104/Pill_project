"""Medication guide builder backed by openFDA + Supabase cache table."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import quote

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

import database
from ndc_normalize import normalize_ndc_to_11
from services.dailymed_client import DailyMedClient
from services.dailymed_spl_client import fetch_spl_sections
from services.medication_summary import generate_medication_summary
from services.openfda_client import OpenFDAClient, OpenFDAUpstreamError
from services.spl_medguide import fetch_boxed_warning_html, fetch_medguide_html
from services.spl_professional import ProfessionalRendered, fetch_professional_rendered

logger = logging.getLogger(__name__)

CACHE_TTL_DAYS = 30
DISCLAIMER = (
    "This information is for educational purposes only and is not medical advice. "
    "Always consult a healthcare professional before taking any medication. "
    "Source: U.S. FDA Medication Guide via openFDA / DailyMed (National Library of Medicine)."
)


class GuideNotFoundError(RuntimeError):
    """Raised when no FDA label can be found for the requested drug."""


class GuideInternalError(RuntimeError):
    """Raised when database access fails for guide operations."""


class GuideValidationError(RuntimeError):
    """Raised when input parameters are invalid."""


SECTION_MAPPING: dict[str, tuple[str, ...]] = {
    "overview": ("medication_guide", "patient_package_insert", "spl_patient_package_insert"),
    "uses": ("indications_and_usage",),
    "dosage": ("dosage_and_administration", "dosage_forms_and_strengths"),
    "how_to_take": ("instructions_for_use", "information_for_patients"),
    "side_effects": ("adverse_reactions",),
    "warnings": ("boxed_warning", "warnings_and_cautions", "warnings"),
    "interactions": ("drug_interactions",),
    "contraindications": ("contraindications",),
    "special_populations": (
        "use_in_specific_populations",
        "pregnancy",
        "lactation",
        "pediatric_use",
        "geriatric_use",
    ),
    "overdose": ("overdosage",),
    "storage": ("storage_and_handling", "how_supplied"),
    "pharmacology": ("mechanism_of_action", "clinical_pharmacology"),
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
    "professional_html",
    "professional_meta",
    "medguide_html",
    "boxed_warning_html",
    "medication_summary_json",
    "medication_summary_html",
    "medication_summary_source",
    "medication_summary_generated_at",
    "fetched_at",
    "updated_at",
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


def _row_to_response(
    row: dict[str, Any],
    *,
    include_professional: bool = False,
    include_medguide: bool = False,
    include_boxed_warning: bool = False,
) -> dict[str, Any]:
    """Convert a medication_guide row dict into API response shape."""
    professional_meta = row.get("professional_meta") if include_professional else None
    medication_summary_json = _deserialize_jsonb(row.get("medication_summary_json"))
    medguide_html = row.get("medguide_html")
    has_medguide = bool(medguide_html and str(medguide_html).strip())
    has_medication_summary = bool(
        (row.get("medication_summary_html") and str(row.get("medication_summary_html")).strip())
        or (
            isinstance(medication_summary_json, dict)
            and isinstance(medication_summary_json.get("questions"), list)
            and len(medication_summary_json.get("questions")) > 0
        )
    )
    # API callers may send different name fields depending on source:
    # prefer branded/proprietary names, then generic/common identifiers.
    display_name = (
        row.get("brand_name")
        or row.get("proprietary_name")
        or row.get("generic_name")
        or row.get("name")
        or row.get("medicine_name")
    )
    return {
        "rxcui": row.get("rxcui"),
        "ndc": row.get("ndc"),
        "generic_name": row.get("generic_name"),
        "brand_name": row.get("brand_name"),
        "display_name": display_name,
        "has_boxed_warning": bool(row.get("has_boxed_warning")),
        "has_medguide": has_medguide,
        "has_medication_summary": has_medication_summary,
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
        "professional_html": row.get("professional_html") if include_professional else None,
        "professional_highlights_html": (
            professional_meta.get("highlights_html") if isinstance(professional_meta, dict) else None
        ),
        "professional_sections": (
            professional_meta.get("sections") if isinstance(professional_meta, dict) else None
        ),
        "medguide_html": medguide_html if include_medguide else None,
        "boxed_warning_html": row.get("boxed_warning_html") if include_boxed_warning else None,
        "medication_summary_json": medication_summary_json,
        "medication_summary_html": row.get("medication_summary_html"),
        "medication_summary_source": row.get("medication_summary_source"),
        "medication_summary_generated_at": _to_iso(row.get("medication_summary_generated_at")),
        "fetched_at": _to_iso(row.get("fetched_at")),
        "disclaimer": DISCLAIMER,
    }


def _build_professional_meta(professional: ProfessionalRendered) -> dict[str, Any]:
    return {
        "highlights_html": professional.highlights_html,
        "sections": [[slug, label] for slug, label in professional.sections],
    }


def _build_medication_summary_payload(row: dict[str, Any]) -> dict[str, Any]:
    summary_json, summary_html = generate_medication_summary(row)
    return {
        "medication_summary_json": summary_json,
        "medication_summary_html": summary_html,
        "medication_summary_source": "fda_dailymed_professional_label",
        "medication_summary_generated_at": datetime.now(timezone.utc),
    }


def _is_stale(fetched_at: Any) -> bool:
    """Return True when fetched_at is older than the configured cache TTL."""
    if not isinstance(fetched_at, datetime):
        return True
    threshold = datetime.now(timezone.utc) - timedelta(days=CACHE_TTL_DAYS)
    dt = fetched_at if fetched_at.tzinfo else fetched_at.replace(tzinfo=timezone.utc)
    return dt < threshold


def _is_identifier_mismatch(
    cached: dict[str, Any],
    *,
    incoming_ndc: Optional[str] = None,
    incoming_spl_set_id: Optional[str] = None,
) -> bool:
    """Return True when incoming identifiers differ from cached ones, forcing a re-fetch.

    This catches cases where a pill's NDC or SPL Set ID was updated after the
    guide row was first cached, which would otherwise serve stale data indefinitely.
    """
    if incoming_ndc and cached.get("ndc"):
        if incoming_ndc.replace("-", "") != str(cached["ndc"]).replace("-", ""):
            return True
    if incoming_spl_set_id and cached.get("spl_set_id"):
        if incoming_spl_set_id.strip() != str(cached["spl_set_id"]).strip():
            return True
    return False


def _row_as_dict(keys: list[str], row: Any) -> dict[str, Any]:
    return dict(zip(keys, row))


def _serialize_jsonb(value: Any) -> Optional[str]:
    """Serialize a Python dict to a JSON string for JSONB columns.

    asyncpg and psycopg2 cannot bind a Python dict to a JSONB column when
    using ``sqlalchemy.text()`` with named parameters — the driver has no
    type inference context to know it should encode the value as JSON.
    Passing a pre-serialised JSON string and using ``CAST(:col AS JSONB)``
    in the SQL is the safest, driver-agnostic fix.
    """
    if value is None:
        return None
    if isinstance(value, dict):
        return json.dumps(value)
    # Already a string (e.g. already serialised by a previous call or read back
    # from the DB as a string in some driver configurations).
    return value


def _deserialize_jsonb(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return None
    return value


def _select_cached_row_by_spl_set_id(conn, spl_set_id: str) -> Optional[dict[str, Any]]:
    """Load cached medication_guide row by spl_set_id."""
    row = conn.execute(
        text("SELECT * FROM public.medication_guide WHERE spl_set_id = :spl_set_id LIMIT 1"),
        {"spl_set_id": spl_set_id},
    ).fetchone()
    if row:
        return _row_as_dict(list(row._mapping.keys()), row)
    return None


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
        encoded_set_id = quote(spl_set_id, safe="")
        mapped["source_url"] = (
            f"https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid={encoded_set_id}"
        )
    elif generic_name:
        encoded_name = quote(generic_name, safe="")
        mapped["source_url"] = (
            "https://dailymed.nlm.nih.gov/dailymed/search.cfm"
            f"?query={encoded_name}&SearchTerm={encoded_name}"
        )
    else:
        mapped["source_url"] = "https://dailymed.nlm.nih.gov/dailymed/"

    return mapped


def _payload_with_timestamps(payload: dict[str, Any]) -> dict[str, Any]:
    out = dict(payload)
    now = datetime.now(timezone.utc)
    out["updated_at"] = now
    out["fetched_at"] = now
    return out


def _update_guide(conn, payload: dict[str, Any], *, existing_id: int) -> dict[str, Any]:
    """Update one medication_guide row and return it."""
    payload = dict(payload)
    payload = _payload_with_timestamps(payload)
    params = {col: payload.get(col) for col in _GUIDE_COLUMNS}
    # JSONB columns must be passed as JSON strings; the CAST in the SQL handles
    # the string→jsonb conversion so the driver never needs to infer the type.
    params["professional_meta"] = _serialize_jsonb(params.get("professional_meta"))
    params["medication_summary_json"] = _serialize_jsonb(params.get("medication_summary_json"))
    conn.execute(
        text(
            """
            UPDATE public.medication_guide
            SET
                rxcui = :rxcui,
                ndc = :ndc,
                spl_set_id = :spl_set_id,
                generic_name = :generic_name,
                brand_name = :brand_name,
                overview = :overview,
                uses = :uses,
                dosage = :dosage,
                how_to_take = :how_to_take,
                side_effects = :side_effects,
                warnings = :warnings,
                interactions = :interactions,
                contraindications = :contraindications,
                special_populations = :special_populations,
                overdose = :overdose,
                storage = :storage,
                pharmacology = :pharmacology,
                manufacturer = :manufacturer,
                has_boxed_warning = :has_boxed_warning,
                source_url = :source_url,
                professional_html = COALESCE(:professional_html, professional_html),
                professional_meta = COALESCE(CAST(:professional_meta AS JSONB), professional_meta),
                medguide_html = COALESCE(:medguide_html, medguide_html),
                boxed_warning_html = COALESCE(:boxed_warning_html, boxed_warning_html),
                medication_summary_json = COALESCE(CAST(:medication_summary_json AS JSONB), medication_summary_json),
                medication_summary_html = COALESCE(:medication_summary_html, medication_summary_html),
                medication_summary_source = COALESCE(:medication_summary_source, medication_summary_source),
                medication_summary_generated_at = COALESCE(:medication_summary_generated_at, medication_summary_generated_at),
                fetched_at = :fetched_at,
                updated_at = :updated_at
            WHERE id = :id
            """
        ),
        {**params, "id": existing_id},
    )
    row = conn.execute(
        text("SELECT * FROM public.medication_guide WHERE id = :id LIMIT 1"),
        {"id": existing_id},
    ).fetchone()
    return _row_as_dict(list(row._mapping.keys()), row)


def _insert_guide(conn, payload: dict[str, Any]) -> dict[str, Any]:
    """Insert one medication_guide row and return it."""
    payload = _payload_with_timestamps(payload)
    params = {col: payload.get(col) for col in _GUIDE_COLUMNS}
    # JSONB columns must be serialised to a JSON string so the driver can bind
    # them; CAST in the SQL converts the string to the JSONB column type.
    params["professional_meta"] = _serialize_jsonb(params.get("professional_meta"))
    params["medication_summary_json"] = _serialize_jsonb(params.get("medication_summary_json"))
    row = conn.execute(
        text(
            """
            INSERT INTO public.medication_guide (
                rxcui, ndc, spl_set_id, generic_name, brand_name,
                overview, uses, dosage, how_to_take, side_effects,
                warnings, interactions, contraindications, special_populations,
                overdose, storage, pharmacology, manufacturer,
                has_boxed_warning, source_url, professional_html, professional_meta, medguide_html, boxed_warning_html,
                medication_summary_json, medication_summary_html, medication_summary_source, medication_summary_generated_at,
                fetched_at, updated_at
            )
            VALUES (
                :rxcui, :ndc, :spl_set_id, :generic_name, :brand_name,
                :overview, :uses, :dosage, :how_to_take, :side_effects,
                :warnings, :interactions, :contraindications, :special_populations,
                :overdose, :storage, :pharmacology, :manufacturer,
                :has_boxed_warning, :source_url, :professional_html, CAST(:professional_meta AS JSONB), :medguide_html, :boxed_warning_html,
                CAST(:medication_summary_json AS JSONB), :medication_summary_html, :medication_summary_source, :medication_summary_generated_at,
                :fetched_at, :updated_at
            )
            RETURNING *
            """
        ),
        params,
    ).fetchone()
    return _row_as_dict(list(row._mapping.keys()), row)


async def build_guide(
    *,
    rxcui: Optional[str] = None,
    ndc: Optional[str] = None,
    spl_set_id: Optional[str] = None,
    force_refresh: bool = False,
    include_professional: bool = False,
    include_medguide: bool = False,
    include_boxed_warning: bool = False,
    openfda_client: Optional[OpenFDAClient] = None,
    dailymed_client: Optional[DailyMedClient] = None,
) -> dict[str, Any]:
    """Resolve, cache, and return a medication guide by SPL Set ID, RxCUI, or NDC.

    Args:
        rxcui: Preferred lookup key.
        ndc: Fallback or primary lookup key when RxCUI is unavailable.
        spl_set_id: Direct DailyMed SPL Set ID; takes priority over rxcui/ndc.
        force_refresh: If True, bypasses cache freshness checks.
        include_professional: If True, include rendered professional HTML.
        include_medguide: If True, include rendered medguide HTML.
        include_boxed_warning: If True, include rendered boxed warning HTML.
        openfda_client: Optional injectable client for tests.
        dailymed_client: Optional injectable DailyMed client for tests.

    Returns:
        API response payload for one medication guide.

    Raises:
        GuideNotFoundError: When no label can be found for the requested drug.
        OpenFDAUpstreamError: When openFDA fails after retries.
        GuideInternalError: When database is unavailable.
    """
    # When spl_set_id is provided, skip NDC validation and bypass openFDA entirely.
    if spl_set_id:
        return await _build_guide_by_spl_set_id(
            spl_set_id=spl_set_id,
            force_refresh=force_refresh,
            include_professional=include_professional,
            include_medguide=include_medguide,
            include_boxed_warning=include_boxed_warning,
            dailymed_client=dailymed_client,
        )

    if not rxcui and not ndc:
        raise GuideNotFoundError("No FDA label found for this drug")

    normalized_ndc = normalize_ndc_to_11(ndc) if ndc else None
    if ndc and not normalized_ndc:
        raise GuideValidationError("Invalid NDC format")

    if not database.db_engine and not database.connect_to_database():
        raise GuideInternalError("Database connection not available")

    client = openfda_client or OpenFDAClient()

    with database.db_engine.connect() as conn:
        cached = _select_cached_row(conn, rxcui=rxcui, ndc=normalized_ndc)
        if cached and not force_refresh and not _is_stale(cached.get("fetched_at")):
            has_identifier_mismatch = _is_identifier_mismatch(cached, incoming_ndc=normalized_ndc)
            if has_identifier_mismatch:
                logger.warning(
                    "Medication guide NDC mismatch for rxcui=%s: cached ndc=%s incoming ndc=%s — forcing re-fetch",
                    rxcui,
                    cached.get("ndc"),
                    normalized_ndc,
                )
            if not has_identifier_mismatch:
                logger.debug("Medication guide cache hit for rxcui=%s ndc=%s", rxcui, normalized_ndc)
                if (
                    include_professional
                    and cached.get("spl_set_id")
                    and (not cached.get("professional_html") or not cached.get("professional_meta"))
                ):
                    try:
                        professional = await fetch_professional_rendered(str(cached["spl_set_id"]))
                        if professional:
                            new_payload = {
                                **cached,
                                "professional_html": professional.article_html,
                                "professional_meta": _build_professional_meta(professional),
                            }
                            if not new_payload.get("medguide_html"):
                                new_payload.update(_build_medication_summary_payload(new_payload))
                            if cached.get("id") is not None:
                                try:
                                    with database.db_engine.begin() as write_conn:
                                        cached = _update_guide(
                                            write_conn,
                                            new_payload,
                                            existing_id=int(cached["id"]),
                                        )
                                except SQLAlchemyError:
                                    logger.exception(
                                        "include_professional lazy-fill DB write failed for spl_set_id=%s — "
                                        "returning in-memory render without persistence",
                                        cached.get("spl_set_id"),
                                    )
                                    # Use the in-memory rendered result even though the DB write failed
                                    # so the caller still receives the professional HTML this request.
                                    cached = new_payload
                            else:
                                cached = new_payload
                    except Exception:
                        logger.exception(
                            "include_professional lazy-fill fetch failed for spl_set_id=%s",
                            cached.get("spl_set_id"),
                        )
                if include_medguide and not cached.get("medguide_html") and cached.get("spl_set_id"):
                    try:
                        mg_html = await fetch_medguide_html(str(cached["spl_set_id"]))
                        if mg_html and cached.get("id") is not None:
                            with database.db_engine.begin() as write_conn:
                                cached = _update_guide(
                                    write_conn,
                                    {**cached, "medguide_html": mg_html},
                                    existing_id=int(cached["id"]),
                                )
                        elif mg_html:
                            cached = {**cached, "medguide_html": mg_html}
                    except (Exception, SQLAlchemyError):
                        logger.exception(
                            "include_medguide lazy-fill failed for spl_set_id=%s",
                            cached.get("spl_set_id"),
                        )
                if include_boxed_warning and not cached.get("boxed_warning_html") and cached.get("spl_set_id"):
                    try:
                        bw_html = await fetch_boxed_warning_html(str(cached["spl_set_id"]))
                        if bw_html and cached.get("id") is not None:
                            with database.db_engine.begin() as write_conn:
                                cached = _update_guide(
                                    write_conn,
                                    {**cached, "boxed_warning_html": bw_html},
                                    existing_id=int(cached["id"]),
                                )
                        elif bw_html:
                            cached = {**cached, "boxed_warning_html": bw_html}
                    except (Exception, SQLAlchemyError):
                        logger.exception(
                            "include_boxed_warning lazy-fill failed for spl_set_id=%s",
                            cached.get("spl_set_id"),
                        )
                if (
                    cached.get("professional_html")
                    and not cached.get("medguide_html")
                    and not cached.get("medication_summary_html")
                    and cached.get("id") is not None
                ):
                    try:
                        with database.db_engine.begin() as write_conn:
                            cached = _update_guide(
                                write_conn,
                                {**cached, **_build_medication_summary_payload(cached)},
                                existing_id=int(cached["id"]),
                            )
                    except SQLAlchemyError:
                        logger.exception(
                            "medication_summary lazy-fill failed for spl_set_id=%s",
                            cached.get("spl_set_id"),
                        )
                return _row_to_response(
                    cached,
                    include_professional=include_professional,
                    include_medguide=include_medguide,
                    include_boxed_warning=include_boxed_warning,
                )

    logger.info(
        "Medication guide fetch from openFDA (cache %s) for rxcui=%s ndc=%s",
        "stale" if cached else "miss",
        rxcui,
        normalized_ndc,
    )

    label_record = None
    if rxcui:
        label_record = await client.fetch_label_by_rxcui(rxcui)

    if label_record is None and normalized_ndc:
        label_record = await client.fetch_label_by_ndc(normalized_ndc)

    if label_record is None:
        raise GuideNotFoundError("No FDA label found for this drug")

    mapped = _map_openfda_record(label_record, requested_rxcui=rxcui)

    # Attempt to fetch structured HTML from DailyMed SPL XML.
    # Use spl_set_id from openFDA response first; fall back to the cached DB value
    # (openFDA often omits spl_set_id even when it exists in DailyMed).
    resolved_spl_set_id = mapped.get("spl_set_id") or (cached.get("spl_set_id") if cached else None)
    if resolved_spl_set_id:
        # Ensure the resolved spl_set_id is stored in the mapped payload too
        if not mapped.get("spl_set_id"):
            mapped["spl_set_id"] = resolved_spl_set_id
            encoded_set_id = quote(resolved_spl_set_id, safe="")
            mapped["source_url"] = (
                f"https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid={encoded_set_id}"
            )

        # Try to fetch fully structured HTML for all sections from DailyMed SPL XML.
        # On success, overlay the openFDA plain-text fields with HTML.
        # On failure, fall back to the existing DailyMed patient-guide text for overview.
        spl_sections: dict = {}
        try:
            spl_sections = await fetch_spl_sections(resolved_spl_set_id)
        except Exception:
            logger.warning(
                "SPL sections fetch raised for spl_set_id=%s, using openFDA fallback",
                resolved_spl_set_id,
                exc_info=True,
            )

        if spl_sections:
            for key in SECTION_MAPPING:
                if spl_sections.get(key):
                    mapped[key] = spl_sections[key]
            if spl_sections.get("_has_boxed_warning"):
                mapped["has_boxed_warning"] = True
            logger.info(
                "DailyMed SPL HTML sections applied for spl_set_id=%s", resolved_spl_set_id
            )
        else:
            # Fall back to patient-guide plain text from DailyMed for overview only
            dm_client = dailymed_client or DailyMedClient()
            try:
                dm_result = dm_client.fetch_patient_guide(resolved_spl_set_id)
                if dm_result and dm_result.get("full_text"):
                    mapped["overview"] = dm_result["full_text"]
                    logger.info(
                        "DailyMed overview set for spl_set_id=%s (%d chars)",
                        resolved_spl_set_id,
                        len(mapped["overview"]),
                    )
            except Exception:
                logger.warning(
                    "DailyMed fetch failed for spl_set_id=%s, using openFDA fallback",
                    resolved_spl_set_id,
                    exc_info=True,
                )

        try:
            professional = await fetch_professional_rendered(resolved_spl_set_id)
            if professional:
                mapped["professional_html"] = professional.article_html
                mapped["professional_meta"] = _build_professional_meta(professional)
        except Exception:
            logger.exception(
                "professional fetch failed for spl_set_id=%s",
                resolved_spl_set_id,
            )

        if include_medguide:
            mapped["medguide_html"] = await fetch_medguide_html(resolved_spl_set_id)

        if include_boxed_warning:
            mapped["boxed_warning_html"] = await fetch_boxed_warning_html(resolved_spl_set_id)

        if mapped.get("professional_html") and not mapped.get("medguide_html"):
            mapped.update(_build_medication_summary_payload(mapped))

    existing_id = int(cached["id"]) if cached and cached.get("id") is not None else None

    if existing_id is None:
        with database.db_engine.connect() as conn:
            existing = _select_cached_row(conn, rxcui=mapped.get("rxcui"), ndc=mapped.get("ndc"))
        existing_id = int(existing["id"]) if existing and existing.get("id") is not None else None

    if existing_id is not None:
        with database.db_engine.begin() as write_conn:
            row = _update_guide(write_conn, mapped, existing_id=existing_id)
        return _row_to_response(
            row,
            include_professional=include_professional,
            include_medguide=include_medguide,
            include_boxed_warning=include_boxed_warning,
        )

    try:
        with database.db_engine.begin() as write_conn:
            row = _insert_guide(write_conn, mapped)
    except IntegrityError as exc:
        with database.db_engine.connect() as conn:
            existing = _select_cached_row(conn, rxcui=mapped.get("rxcui"), ndc=mapped.get("ndc"))
        if not existing or existing.get("id") is None:
            raise GuideInternalError(
                "Integrity conflict detected but no existing medication_guide row could be resolved"
            ) from exc
        with database.db_engine.begin() as write_conn:
            row = _update_guide(write_conn, mapped, existing_id=int(existing["id"]))

    return _row_to_response(
        row,
        include_professional=include_professional,
        include_medguide=include_medguide,
        include_boxed_warning=include_boxed_warning,
    )


async def _build_guide_by_spl_set_id(
    *,
    spl_set_id: str,
    force_refresh: bool = False,
    include_professional: bool = False,
    include_medguide: bool = False,
    include_boxed_warning: bool = False,
    dailymed_client: Optional[DailyMedClient] = None,
) -> dict[str, Any]:
    """Hydrate a medication guide directly from DailyMed using a known SPL Set ID.

    Does not require rxcui or ndc; does not validate NDC.  Preserves any
    existing rxcui/ndc/generic_name/brand_name metadata already in the cache.
    """
    if not database.db_engine and not database.connect_to_database():
        raise GuideInternalError("Database connection not available")

    with database.db_engine.connect() as conn:
        cached = _select_cached_row_by_spl_set_id(conn, spl_set_id)

    if cached and not force_refresh and not _is_stale(cached.get("fetched_at")):
        has_identifier_mismatch = _is_identifier_mismatch(
            cached, incoming_spl_set_id=spl_set_id
        )
        if has_identifier_mismatch:
            logger.warning(
                "Medication guide SPL set ID mismatch: cached spl_set_id=%s incoming spl_set_id=%s — forcing re-fetch",
                cached.get("spl_set_id"),
                spl_set_id,
            )
        if not has_identifier_mismatch:
            logger.debug("Medication guide cache hit for spl_set_id=%s", spl_set_id)
            # Lazy-fill missing HTML fields if spl_set_id is already known
            if include_professional and cached.get("spl_set_id") and (
                not cached.get("professional_html") or not cached.get("professional_meta")
            ):
                try:
                    professional = await fetch_professional_rendered(str(cached["spl_set_id"]))
                    if professional:
                        new_payload = {
                            **cached,
                            "professional_html": professional.article_html,
                            "professional_meta": _build_professional_meta(professional),
                        }
                        if not new_payload.get("medguide_html"):
                            new_payload.update(_build_medication_summary_payload(new_payload))
                        if cached.get("id") is not None:
                            try:
                                with database.db_engine.begin() as write_conn:
                                    cached = _update_guide(
                                        write_conn, new_payload, existing_id=int(cached["id"])
                                    )
                            except SQLAlchemyError:
                                logger.exception(
                                    "include_professional lazy-fill DB write failed for spl_set_id=%s",
                                    cached.get("spl_set_id"),
                                )
                                cached = new_payload
                        else:
                            cached = new_payload
                except Exception:
                    logger.exception(
                        "include_professional lazy-fill fetch failed for spl_set_id=%s",
                        cached.get("spl_set_id"),
                    )
            if include_medguide and not cached.get("medguide_html") and cached.get("spl_set_id"):
                try:
                    mg_html = await fetch_medguide_html(str(cached["spl_set_id"]))
                    if mg_html and cached.get("id") is not None:
                        with database.db_engine.begin() as write_conn:
                            cached = _update_guide(
                                write_conn,
                                {**cached, "medguide_html": mg_html},
                                existing_id=int(cached["id"]),
                            )
                    elif mg_html:
                        cached = {**cached, "medguide_html": mg_html}
                except (Exception, SQLAlchemyError):
                    logger.exception(
                        "include_medguide lazy-fill failed for spl_set_id=%s",
                        cached.get("spl_set_id"),
                    )
            if include_boxed_warning and not cached.get("boxed_warning_html") and cached.get("spl_set_id"):
                try:
                    bw_html = await fetch_boxed_warning_html(str(cached["spl_set_id"]))
                    if bw_html and cached.get("id") is not None:
                        with database.db_engine.begin() as write_conn:
                            cached = _update_guide(
                                write_conn,
                                {**cached, "boxed_warning_html": bw_html},
                                existing_id=int(cached["id"]),
                            )
                    elif bw_html:
                        cached = {**cached, "boxed_warning_html": bw_html}
                except (Exception, SQLAlchemyError):
                    logger.exception(
                        "include_boxed_warning lazy-fill failed for spl_set_id=%s",
                        cached.get("spl_set_id"),
                    )
            if (
                cached.get("professional_html")
                and not cached.get("medguide_html")
                and not cached.get("medication_summary_html")
                and cached.get("id") is not None
            ):
                try:
                    with database.db_engine.begin() as write_conn:
                        cached = _update_guide(
                            write_conn,
                            {**cached, **_build_medication_summary_payload(cached)},
                            existing_id=int(cached["id"]),
                        )
                except SQLAlchemyError:
                    logger.exception(
                        "medication_summary lazy-fill failed for spl_set_id=%s",
                        cached.get("spl_set_id"),
                    )
            return _row_to_response(
                cached,
                include_professional=include_professional,
                include_medguide=include_medguide,
                include_boxed_warning=include_boxed_warning,
            )

    logger.info(
        "Medication guide fetch from DailyMed (cache %s) for spl_set_id=%s",
        "stale" if cached else "miss",
        spl_set_id,
    )

    # Start from any cached metadata so rxcui/ndc/names are preserved on re-hydration
    encoded_set_id = quote(spl_set_id, safe="")
    mapped: dict[str, Any] = {
        "spl_set_id": spl_set_id,
        "source_url": f"https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid={encoded_set_id}",
        # Preserve existing identifiers and names from cache where available
        "rxcui": (cached or {}).get("rxcui"),
        "ndc": (cached or {}).get("ndc"),
        "generic_name": (cached or {}).get("generic_name"),
        "brand_name": (cached or {}).get("brand_name"),
        "has_boxed_warning": (cached or {}).get("has_boxed_warning") or False,
    }

    # Fetch structured HTML sections from DailyMed SPL XML
    spl_sections: dict = {}
    try:
        spl_sections = await fetch_spl_sections(spl_set_id)
    except Exception:
        logger.warning(
            "SPL sections fetch raised for spl_set_id=%s",
            spl_set_id,
            exc_info=True,
        )

    if spl_sections:
        for key in SECTION_MAPPING:
            if spl_sections.get(key):
                mapped[key] = spl_sections[key]
        if spl_sections.get("_has_boxed_warning"):
            mapped["has_boxed_warning"] = True
        logger.info("DailyMed SPL HTML sections applied for spl_set_id=%s", spl_set_id)
    else:
        # Fall back to patient-guide plain text for overview only
        dm_client = dailymed_client or DailyMedClient()
        try:
            dm_result = dm_client.fetch_patient_guide(spl_set_id)
            if dm_result and dm_result.get("full_text"):
                mapped["overview"] = dm_result["full_text"]
                logger.info(
                    "DailyMed overview set for spl_set_id=%s (%d chars)",
                    spl_set_id,
                    len(mapped["overview"]),
                )
        except Exception:
            logger.warning(
                "DailyMed patient-guide fetch failed for spl_set_id=%s",
                spl_set_id,
                exc_info=True,
            )

    try:
        professional = await fetch_professional_rendered(spl_set_id)
        if professional:
            mapped["professional_html"] = professional.article_html
            mapped["professional_meta"] = _build_professional_meta(professional)
    except Exception:
        logger.exception("professional fetch failed for spl_set_id=%s", spl_set_id)

    if include_medguide:
        mapped["medguide_html"] = await fetch_medguide_html(spl_set_id)

    if include_boxed_warning:
        mapped["boxed_warning_html"] = await fetch_boxed_warning_html(spl_set_id)

    if mapped.get("professional_html") and not mapped.get("medguide_html"):
        mapped.update(_build_medication_summary_payload(mapped))

    # If sections and HTML are all None, this guide essentially has no content — treat as not found
    section_values = [mapped.get(key) for key in SECTION_MAPPING]
    if not any(section_values) and not mapped.get("professional_html") and not mapped.get("medguide_html"):
        raise GuideNotFoundError(f"No DailyMed content found for spl_set_id={spl_set_id}")

    existing_id = int(cached["id"]) if cached and cached.get("id") is not None else None

    if existing_id is None:
        # Try to find by spl_set_id again (race-condition guard) or rxcui/ndc
        with database.db_engine.connect() as conn:
            existing = _select_cached_row_by_spl_set_id(conn, spl_set_id)
            if existing is None and (mapped.get("rxcui") or mapped.get("ndc")):
                existing = _select_cached_row(conn, rxcui=mapped.get("rxcui"), ndc=mapped.get("ndc"))
        existing_id = int(existing["id"]) if existing and existing.get("id") is not None else None

    if existing_id is not None:
        with database.db_engine.begin() as write_conn:
            row = _update_guide(write_conn, mapped, existing_id=existing_id)
        return _row_to_response(
            row,
            include_professional=include_professional,
            include_medguide=include_medguide,
            include_boxed_warning=include_boxed_warning,
        )

    try:
        with database.db_engine.begin() as write_conn:
            row = _insert_guide(write_conn, mapped)
    except IntegrityError as exc:
        with database.db_engine.connect() as conn:
            existing = _select_cached_row_by_spl_set_id(conn, spl_set_id)
            if existing is None and (mapped.get("rxcui") or mapped.get("ndc")):
                existing = _select_cached_row(conn, rxcui=mapped.get("rxcui"), ndc=mapped.get("ndc"))
        if not existing or existing.get("id") is None:
            raise GuideInternalError(
                "Integrity conflict detected but no existing medication_guide row could be resolved"
            ) from exc
        with database.db_engine.begin() as write_conn:
            row = _update_guide(write_conn, mapped, existing_id=int(existing["id"]))

    return _row_to_response(
        row,
        include_professional=include_professional,
        include_medguide=include_medguide,
        include_boxed_warning=include_boxed_warning,
    )
