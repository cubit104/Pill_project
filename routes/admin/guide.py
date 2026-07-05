"""Admin medication guide management endpoints."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Literal, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

import database
from ndc_normalize import normalize_ndc_to_11
from routes.admin.auth import get_admin_user, log_audit, require_superuser
from services.medication_guide import (
    DAILYMED_SPLS_LOOKUP_URL,
    GuideInternalError,
    GuideNotFoundError,
    GuideValidationError,
    build_guide,
)
from services.openfda_client import OpenFDAUpstreamError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/guide", tags=["admin-guide"])


class SetSetIdPayload(BaseModel):
    spl_set_id: str


class RefetchPayload(BaseModel):
    target: Literal["all", "professional", "medguide", "dosage", "side_effects"] = "all"


class ContentPayload(BaseModel):
    field: Literal["professional_html", "medguide_html", "dosage_administration", "adverse_reactions"]
    content: str


def _ensure_db() -> None:
    if not database.db_engine:
        database.connect_to_database()


def _to_iso(value: Any) -> Optional[str]:
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    return str(value)


def _content_status(value: Any) -> bool:
    return bool(isinstance(value, str) and value.strip())


def _char_count(value: Any) -> int:
    if not isinstance(value, str):
        return 0
    return len(value)


def _row_as_dict(row: Any) -> dict[str, Any]:
    return dict(row._mapping)


def _find_pill(conn, pill_id: str) -> dict[str, Any]:
    row = conn.execute(
        text(
            """
            SELECT id, medicine_name, spl_strength, rxcui, ndc11, ndc9, spl_set_id, slug
            FROM pillfinder
            WHERE id = :id
            LIMIT 1
            """
        ),
        {"id": pill_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Pill not found")
    return _row_as_dict(row)


def _find_guide_row(conn, pill: dict[str, Any]) -> Optional[dict[str, Any]]:
    params = {
        "spl_set_id": str(pill.get("spl_set_id") or "").strip(),
        "rxcui": str(pill.get("rxcui") or "").strip(),
        "ndc11": str(pill.get("ndc11") or "").strip(),
        "ndc11_clean": str(pill.get("ndc11") or "").replace("-", "").strip(),
        "ndc9": str(pill.get("ndc9") or "").strip(),
        "ndc9_clean": str(pill.get("ndc9") or "").replace("-", "").strip(),
    }
    row = conn.execute(
        text(
            """
            SELECT *
            FROM public.medication_guide mg
            WHERE (
                    :spl_set_id <> ''
                    AND mg.spl_set_id = :spl_set_id
                ) OR (
                    :rxcui <> ''
                    AND mg.rxcui = :rxcui
                ) OR (
                    :ndc11 <> ''
                    AND (
                        mg.ndc = :ndc11
                        OR REPLACE(COALESCE(mg.ndc, ''), '-', '') = :ndc11_clean
                    )
                ) OR (
                    :ndc9 <> ''
                    AND (
                        mg.ndc = :ndc9
                        OR REPLACE(COALESCE(mg.ndc, ''), '-', '') = :ndc9_clean
                    )
                )
            ORDER BY
                CASE WHEN :spl_set_id <> '' AND mg.spl_set_id = :spl_set_id THEN 0 ELSE 1 END,
                CASE WHEN :rxcui <> '' AND mg.rxcui = :rxcui THEN 0 ELSE 1 END,
                CASE
                    WHEN :ndc11 <> '' AND (
                        mg.ndc = :ndc11
                        OR REPLACE(COALESCE(mg.ndc, ''), '-', '') = :ndc11_clean
                    ) THEN 0
                    ELSE 1
                END,
                mg.updated_at DESC NULLS LAST
            LIMIT 1
            """
        ),
        params,
    ).fetchone()
    if not row:
        return None
    return _row_as_dict(row)


def _build_status_payload(pill: dict[str, Any], guide_row: Optional[dict[str, Any]]) -> dict[str, Any]:
    guide = guide_row or {}
    adverse_or_side = (guide.get("adverse_reactions") or guide.get("side_effects") or "")
    return {
        "pill_id": str(pill.get("id")),
        "medicine_name": pill.get("medicine_name"),
        "spl_set_id": pill.get("spl_set_id") or guide.get("spl_set_id"),
        "rxcui": pill.get("rxcui") or guide.get("rxcui"),
        "ndc": pill.get("ndc11") or guide.get("ndc"),
        "brand_name": guide.get("brand_name"),
        "generic_name": guide.get("generic_name"),
        "source_url": guide.get("source_url"),
        "fetched_at": _to_iso(guide.get("fetched_at")),
        "professional_html": guide.get("professional_html"),
        "medguide_html": guide.get("medguide_html"),
        "dosage_administration": guide.get("dosage_administration"),
        "adverse_reactions": guide.get("adverse_reactions"),
        "side_effects": guide.get("side_effects"),
        "has_professional": _content_status(guide.get("professional_html")),
        "has_medguide": _content_status(guide.get("medguide_html")),
        "has_dosage": _content_status(guide.get("dosage_administration")),
        "has_side_effects": _content_status(adverse_or_side),
        "professional_chars": _char_count(guide.get("professional_html")),
        "medguide_chars": _char_count(guide.get("medguide_html")),
        "dosage_chars": _char_count(guide.get("dosage_administration")),
        "side_effects_chars": _char_count(adverse_or_side),
    }


def _column_exists(conn, *, table: str, column: str) -> bool:
    row = conn.execute(
        text(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = :table_name
              AND column_name = :column_name
            LIMIT 1
            """
        ),
        {"table_name": table, "column_name": column},
    ).fetchone()
    return bool(row)


async def _lookup_setid_from_dailymed(*, key: str, value: str) -> Optional[str]:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                DAILYMED_SPLS_LOOKUP_URL,
                params={key: value},
            )
    except Exception:
        logger.warning("DailyMed lookup failed for %s=%s", key, value, exc_info=True)
        return None

    if response.status_code >= 400:
        return None

    try:
        payload = response.json()
    except Exception:
        return None

    data = payload.get("data")
    if not isinstance(data, list) or not data:
        return None
    first = data[0]
    if not isinstance(first, dict):
        return None
    setid = first.get("setid")
    if not isinstance(setid, str) or not setid.strip():
        return None
    return setid.strip()


@router.get("/search")
def search_guide_pills(
    q: str = Query(""),
    missing_only: bool = Query(False),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    admin: dict = Depends(get_admin_user),
):
    del admin
    _ensure_db()

    filters: list[str] = ["p.deleted_at IS NULL"]
    params: dict[str, Any] = {
        "limit": per_page,
        "offset": (page - 1) * per_page,
    }

    q_norm = q.strip()
    if q_norm:
        filters.append("p.medicine_name ILIKE :q")
        params["q"] = f"%{q_norm}%"

    if missing_only:
        filters.append("(p.spl_set_id IS NULL OR TRIM(p.spl_set_id) = '')")

    where = "WHERE " + " AND ".join(filters)

    try:
        with database.db_engine.connect() as conn:
            total = conn.execute(
                text(f"SELECT COUNT(*) FROM pillfinder p {where}"),
                {k: v for k, v in params.items() if k not in ("limit", "offset")},
            ).scalar() or 0

            rows = conn.execute(
                text(
                    f"""
                    SELECT
                        p.id,
                        p.medicine_name,
                        p.spl_strength,
                        p.rxcui,
                        p.ndc11,
                        p.spl_set_id,
                        p.slug,
                        (NULLIF(mg.professional_html, '') IS NOT NULL) AS has_professional,
                        (NULLIF(mg.medguide_html, '') IS NOT NULL) AS has_medguide,
                        (NULLIF(mg.dosage_administration, '') IS NOT NULL) AS has_dosage,
                        (NULLIF(mg.adverse_reactions, '') IS NOT NULL OR NULLIF(mg.side_effects, '') IS NOT NULL) AS has_side_effects,
                        mg.fetched_at AS guide_fetched_at
                    FROM pillfinder p
                    LEFT JOIN LATERAL (
                        SELECT mg.*
                        FROM public.medication_guide mg
                        WHERE (
                            NULLIF(TRIM(COALESCE(p.spl_set_id, '')), '') IS NOT NULL
                            AND mg.spl_set_id = p.spl_set_id
                        ) OR (
                            NULLIF(TRIM(COALESCE(p.rxcui, '')), '') IS NOT NULL
                            AND mg.rxcui = p.rxcui
                        ) OR (
                            NULLIF(TRIM(COALESCE(p.ndc11, '')), '') IS NOT NULL
                            AND (
                                mg.ndc = p.ndc11
                                OR REPLACE(COALESCE(mg.ndc, ''), '-', '') = REPLACE(COALESCE(p.ndc11, ''), '-', '')
                            )
                        )
                        ORDER BY
                            CASE WHEN NULLIF(TRIM(COALESCE(p.spl_set_id, '')), '') IS NOT NULL AND mg.spl_set_id = p.spl_set_id THEN 0 ELSE 1 END,
                            CASE WHEN NULLIF(TRIM(COALESCE(p.rxcui, '')), '') IS NOT NULL AND mg.rxcui = p.rxcui THEN 0 ELSE 1 END,
                            mg.updated_at DESC NULLS LAST
                        LIMIT 1
                    ) mg ON true
                    {where}
                    ORDER BY LOWER(COALESCE(p.medicine_name, '')) ASC, p.updated_at DESC NULLS LAST
                    LIMIT :limit OFFSET :offset
                    """
                ),
                params,
            ).fetchall()

        pills = [
            {
                "id": str(r[0]),
                "medicine_name": r[1],
                "spl_strength": r[2],
                "rxcui": r[3],
                "ndc11": r[4],
                "spl_set_id": r[5],
                "slug": r[6],
                "has_professional": bool(r[7]),
                "has_medguide": bool(r[8]),
                "has_dosage": bool(r[9]),
                "has_side_effects": bool(r[10]),
                "guide_fetched_at": _to_iso(r[11]),
            }
            for r in rows
        ]

        return {
            "pills": pills,
            "total": total,
            "page": page,
            "per_page": per_page,
            "pages": max(1, -(-total // per_page)),
        }
    except SQLAlchemyError as e:
        logger.error("search_guide_pills DB error: %s", e, exc_info=True)
        root = getattr(e, "orig", None) or e
        raise HTTPException(status_code=500, detail=f"Database error: {root}")


@router.get("/{pill_id}/status")
def get_guide_status(
    pill_id: str,
    admin: dict = Depends(get_admin_user),
):
    del admin
    _ensure_db()

    try:
        with database.db_engine.connect() as conn:
            pill = _find_pill(conn, pill_id)
            guide_row = _find_guide_row(conn, pill)
        return _build_status_payload(pill, guide_row)
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error("get_guide_status DB error: %s", e, exc_info=True)
        root = getattr(e, "orig", None) or e
        raise HTTPException(status_code=500, detail=f"Database error: {root}")


@router.post("/{pill_id}/set-setid")
def set_spl_set_id(
    pill_id: str,
    payload: SetSetIdPayload,
    request: Request,
    admin: dict = Depends(require_superuser),
):
    _ensure_db()

    setid = payload.spl_set_id.strip()
    if not setid:
        raise HTTPException(status_code=400, detail="spl_set_id is required")

    try:
        with database.db_engine.begin() as conn:
            pill = _find_pill(conn, pill_id)
            medicine_name = str(pill.get("medicine_name") or "").strip()
            if not medicine_name:
                raise HTTPException(status_code=400, detail="Pill medicine_name is required")

            conn.execute(
                text(
                    """
                    UPDATE pillfinder
                    SET spl_set_id = :spl_set_id, updated_at = now()
                    WHERE id = :id
                    """
                ),
                {"spl_set_id": setid, "id": pill_id},
            )

            updated_by_name = conn.execute(
                text(
                    """
                    UPDATE pillfinder
                    SET spl_set_id = :spl_set_id, updated_at = now()
                    WHERE id <> :id
                      AND LOWER(COALESCE(medicine_name, '')) = LOWER(:medicine_name)
                      AND (spl_set_id IS NULL OR TRIM(spl_set_id) = '')
                    """
                ),
                {"spl_set_id": setid, "id": pill_id, "medicine_name": medicine_name},
            )

            log_audit(
                conn,
                actor_id=admin.get("id"),
                actor_email=admin.get("email"),
                action="set_medguide_setid",
                entity_type="pill",
                entity_id=str(pill_id),
                diff={"spl_set_id": {"before": pill.get("spl_set_id"), "after": setid}},
                metadata={
                    "medicine_name": medicine_name,
                    "updated_related_rows": int(updated_by_name.rowcount or 0),
                    "source": "manual",
                },
                ip_address=(request.client.host if request.client else None),
                user_agent=request.headers.get("user-agent"),
            )

        return {
            "updated": True,
            "pill_id": pill_id,
            "spl_set_id": setid,
            "updated_related_rows": int(updated_by_name.rowcount or 0),
        }
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error("set_spl_set_id DB error: %s", e, exc_info=True)
        root = getattr(e, "orig", None) or e
        raise HTTPException(status_code=500, detail=f"Database error: {root}")


@router.post("/{pill_id}/lookup-setid")
async def lookup_spl_set_id(
    pill_id: str,
    admin: dict = Depends(get_admin_user),
):
    del admin
    _ensure_db()

    try:
        with database.db_engine.connect() as conn:
            pill = _find_pill(conn, pill_id)
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error("lookup_spl_set_id DB error: %s", e, exc_info=True)
        root = getattr(e, "orig", None) or e
        raise HTTPException(status_code=500, detail=f"Database error: {root}")

    drug_name = str(pill.get("medicine_name") or "").strip()
    ndc11 = str(pill.get("ndc11") or "").strip()
    rxcui = str(pill.get("rxcui") or "").strip()

    if drug_name:
        setid = await _lookup_setid_from_dailymed(key="drug_name", value=drug_name)
        if setid:
            return {"spl_set_id": setid, "source": "drug_name"}

    if ndc11:
        normalized_ndc = normalize_ndc_to_11(ndc11) or ndc11.replace("-", "")
        setid = await _lookup_setid_from_dailymed(key="ndc", value=normalized_ndc)
        if setid:
            return {"spl_set_id": setid, "source": "ndc"}

    if rxcui:
        setid = await _lookup_setid_from_dailymed(key="rxcui", value=rxcui)
        if setid:
            return {"spl_set_id": setid, "source": "rxcui"}

    return {"spl_set_id": None, "source": None}


@router.post("/{pill_id}/refetch")
async def refetch_guide_content(
    pill_id: str,
    payload: RefetchPayload,
    request: Request,
    admin: dict = Depends(require_superuser),
):
    _ensure_db()

    try:
        with database.db_engine.connect() as conn:
            pill = _find_pill(conn, pill_id)
            spl_set_id = str(pill.get("spl_set_id") or "").strip()
            if not spl_set_id:
                raise HTTPException(status_code=400, detail="spl_set_id is required before refetch")

        if payload.target == "all":
            await build_guide(
                spl_set_id=spl_set_id,
                force_refresh=True,
                include_professional=True,
                include_medguide=True,
                include_boxed_warning=True,
            )
        elif payload.target == "professional":
            await build_guide(
                spl_set_id=spl_set_id,
                force_refresh=True,
                include_professional=True,
            )
        elif payload.target == "medguide":
            await build_guide(
                spl_set_id=spl_set_id,
                force_refresh=True,
                include_medguide=True,
            )
        elif payload.target in {"dosage", "side_effects"}:
            await build_guide(
                spl_set_id=spl_set_id,
                force_refresh=True,
                include_professional=True,
            )

        with database.db_engine.begin() as conn:
            log_audit(
                conn,
                actor_id=admin.get("id"),
                actor_email=admin.get("email"),
                action="refetch_medguide",
                entity_type="medication_guide",
                entity_id=str(pill_id),
                metadata={
                    "target": payload.target,
                    "spl_set_id": spl_set_id,
                },
                ip_address=(request.client.host if request.client else None),
                user_agent=request.headers.get("user-agent"),
            )

        with database.db_engine.connect() as conn:
            pill = _find_pill(conn, pill_id)
            guide_row = _find_guide_row(conn, pill)
        return _build_status_payload(pill, guide_row)
    except (GuideNotFoundError, GuideValidationError):
        raise HTTPException(status_code=404, detail="Medication guide source not found")
    except OpenFDAUpstreamError:
        raise HTTPException(status_code=502, detail="Failed to fetch DailyMed/openFDA content")
    except GuideInternalError as exc:
        logger.error("refetch_guide_content internal error for pill=%s: %s", pill_id, exc)
        raise HTTPException(status_code=500, detail="Internal server error")
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error("refetch_guide_content DB error: %s", e, exc_info=True)
        root = getattr(e, "orig", None) or e
        raise HTTPException(status_code=500, detail=f"Database error: {root}")


@router.put("/{pill_id}/content")
def upsert_guide_content(
    pill_id: str,
    payload: ContentPayload,
    request: Request,
    admin: dict = Depends(require_superuser),
):
    _ensure_db()

    field = payload.field
    content = payload.content

    try:
        with database.db_engine.begin() as conn:
            pill = _find_pill(conn, pill_id)
            guide = _find_guide_row(conn, pill)

            if not guide:
                insert_row = conn.execute(
                    text(
                        """
                        INSERT INTO public.medication_guide (
                            rxcui, ndc, spl_set_id, generic_name, brand_name, fetched_at, updated_at
                        )
                        VALUES (
                            :rxcui, :ndc, :spl_set_id, :generic_name, :brand_name, now(), now()
                        )
                        RETURNING *
                        """
                    ),
                    {
                        "rxcui": str(pill.get("rxcui") or "") or None,
                        "ndc": str(pill.get("ndc11") or "") or None,
                        "spl_set_id": str(pill.get("spl_set_id") or "") or None,
                        "generic_name": pill.get("medicine_name"),
                        "brand_name": pill.get("medicine_name"),
                    },
                ).fetchone()
                guide = _row_as_dict(insert_row)

            before_value = guide.get(field)
            params: dict[str, Any] = {"id": guide["id"], "content": content}
            metadata: dict[str, Any] = {"source": "manual", "field": field}

            manual_flag_col = f"manual_override_{field}"
            has_manual_flag_col = _column_exists(conn, table="medication_guide", column=manual_flag_col)
            has_manual_overrides_col = _column_exists(conn, table="medication_guide", column="manual_overrides")

            if has_manual_flag_col:
                metadata["manual_override_column"] = manual_flag_col
                if field == "professional_html":
                    conn.execute(
                        text(
                            """
                            UPDATE public.medication_guide
                            SET professional_html = :content,
                                manual_override_professional_html = true,
                                updated_at = now()
                            WHERE id = :id
                            """
                        ),
                        params,
                    )
                elif field == "medguide_html":
                    conn.execute(
                        text(
                            """
                            UPDATE public.medication_guide
                            SET medguide_html = :content,
                                manual_override_medguide_html = true,
                                updated_at = now()
                            WHERE id = :id
                            """
                        ),
                        params,
                    )
                elif field == "dosage_administration":
                    conn.execute(
                        text(
                            """
                            UPDATE public.medication_guide
                            SET dosage_administration = :content,
                                manual_override_dosage_administration = true,
                                updated_at = now()
                            WHERE id = :id
                            """
                        ),
                        params,
                    )
                else:
                    conn.execute(
                        text(
                            """
                            UPDATE public.medication_guide
                            SET adverse_reactions = :content,
                                manual_override_adverse_reactions = true,
                                updated_at = now()
                            WHERE id = :id
                            """
                        ),
                        params,
                    )
            elif has_manual_overrides_col:
                metadata["manual_override_column"] = "manual_overrides"
                if field == "professional_html":
                    conn.execute(
                        text(
                            """
                            UPDATE public.medication_guide
                            SET professional_html = :content,
                                manual_overrides = COALESCE(manual_overrides, '{}'::jsonb) || jsonb_build_object('professional_html', true),
                                updated_at = now()
                            WHERE id = :id
                            """
                        ),
                        params,
                    )
                elif field == "medguide_html":
                    conn.execute(
                        text(
                            """
                            UPDATE public.medication_guide
                            SET medguide_html = :content,
                                manual_overrides = COALESCE(manual_overrides, '{}'::jsonb) || jsonb_build_object('medguide_html', true),
                                updated_at = now()
                            WHERE id = :id
                            """
                        ),
                        params,
                    )
                elif field == "dosage_administration":
                    conn.execute(
                        text(
                            """
                            UPDATE public.medication_guide
                            SET dosage_administration = :content,
                                manual_overrides = COALESCE(manual_overrides, '{}'::jsonb) || jsonb_build_object('dosage_administration', true),
                                updated_at = now()
                            WHERE id = :id
                            """
                        ),
                        params,
                    )
                else:
                    conn.execute(
                        text(
                            """
                            UPDATE public.medication_guide
                            SET adverse_reactions = :content,
                                manual_overrides = COALESCE(manual_overrides, '{}'::jsonb) || jsonb_build_object('adverse_reactions', true),
                                updated_at = now()
                            WHERE id = :id
                            """
                        ),
                        params,
                    )
            else:
                metadata["manual_override_column"] = None
                if field == "professional_html":
                    conn.execute(
                        text(
                            """
                            UPDATE public.medication_guide
                            SET professional_html = :content,
                                updated_at = now()
                            WHERE id = :id
                            """
                        ),
                        params,
                    )
                elif field == "medguide_html":
                    conn.execute(
                        text(
                            """
                            UPDATE public.medication_guide
                            SET medguide_html = :content,
                                updated_at = now()
                            WHERE id = :id
                            """
                        ),
                        params,
                    )
                elif field == "dosage_administration":
                    conn.execute(
                        text(
                            """
                            UPDATE public.medication_guide
                            SET dosage_administration = :content,
                                updated_at = now()
                            WHERE id = :id
                            """
                        ),
                        params,
                    )
                else:
                    conn.execute(
                        text(
                            """
                            UPDATE public.medication_guide
                            SET adverse_reactions = :content,
                                updated_at = now()
                            WHERE id = :id
                            """
                        ),
                        params,
                    )

            log_audit(
                conn,
                actor_id=admin.get("id"),
                actor_email=admin.get("email"),
                action="update_medguide_content",
                entity_type="medication_guide",
                entity_id=str(guide["id"]),
                diff={field: {"before": before_value, "after": content}},
                metadata=metadata,
                ip_address=(request.client.host if request.client else None),
                user_agent=request.headers.get("user-agent"),
            )

            guide_after = conn.execute(
                text("SELECT * FROM public.medication_guide WHERE id = :id LIMIT 1"),
                {"id": guide["id"]},
            ).fetchone()
            guide = _row_as_dict(guide_after)
            status = _build_status_payload(pill, guide)
            status["updated_field"] = field
            return status
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error("upsert_guide_content DB error: %s", e, exc_info=True)
        root = getattr(e, "orig", None) or e
        raise HTTPException(status_code=500, detail=f"Database error: {root}")


@router.post("/{pill_id}/clear-cache")
def clear_guide_cache(
    pill_id: str,
    request: Request,
    admin: dict = Depends(require_superuser),
):
    _ensure_db()

    try:
        with database.db_engine.begin() as conn:
            pill = _find_pill(conn, pill_id)
            guide = _find_guide_row(conn, pill)
            if not guide:
                return {"deleted": False, "message": "No medication_guide row matched this pill"}

            conn.execute(
                text("DELETE FROM public.medication_guide WHERE id = :id"),
                {"id": guide["id"]},
            )

            log_audit(
                conn,
                actor_id=admin.get("id"),
                actor_email=admin.get("email"),
                action="clear_medguide_cache",
                entity_type="medication_guide",
                entity_id=str(guide["id"]),
                metadata={
                    "source": "manual",
                    "pill_id": str(pill_id),
                    "spl_set_id": pill.get("spl_set_id"),
                    "rxcui": pill.get("rxcui"),
                    "ndc11": pill.get("ndc11"),
                },
                ip_address=(request.client.host if request.client else None),
                user_agent=request.headers.get("user-agent"),
            )

            return {"deleted": True, "guide_id": str(guide["id"])}
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error("clear_guide_cache DB error: %s", e, exc_info=True)
        root = getattr(e, "orig", None) or e
        raise HTTPException(status_code=500, detail=f"Database error: {root}")
