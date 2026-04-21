"""Admin pill management endpoints."""
import json
import logging
from typing import Optional
from datetime import timezone
import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
import bleach

import database
from routes.admin.auth import get_admin_user, log_audit, CRITICAL_FIELDS

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/pills", tags=["admin-pills"])

ALLOWED_TAGS: list = []  # strip all HTML

EDITABLE_FIELDS = [
    "medicine_name", "brand_names", "splimprint", "splcolor_text", "splshape_text",
    "splsize", "spl_strength", "spl_ingredients", "spl_inactive_ing", "dosage_form",
    "route", "dea_schedule_name", "pharmclass_fda_epc", "ndc9", "ndc11", "rxcui",
    "rxcui_1", "status_rx_otc", "imprint_status", "slug", "meta_description",
    "image_filename", "has_image",
]


def _sanitize(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    return bleach.clean(str(value), tags=ALLOWED_TAGS, strip=True)


class PillCreate(BaseModel):
    medicine_name: Optional[str] = None
    brand_names: Optional[str] = None
    splimprint: Optional[str] = None
    splcolor_text: Optional[str] = None
    splshape_text: Optional[str] = None
    splsize: Optional[str] = None
    spl_strength: Optional[str] = None
    spl_ingredients: Optional[str] = None
    spl_inactive_ing: Optional[str] = None
    dosage_form: Optional[str] = None
    route: Optional[str] = None
    dea_schedule_name: Optional[str] = None
    pharmclass_fda_epc: Optional[str] = None
    ndc9: Optional[str] = None
    ndc11: Optional[str] = None
    rxcui: Optional[str] = None
    rxcui_1: Optional[str] = None
    status_rx_otc: Optional[str] = None
    imprint_status: Optional[str] = None
    slug: Optional[str] = None
    meta_description: Optional[str] = None
    idempotency_key: Optional[str] = None


class PillUpdate(PillCreate):
    updated_at: Optional[str] = None  # for optimistic locking


@router.get("")
def list_pills(
    request: Request,
    q: Optional[str] = Query(None),
    color: Optional[str] = Query(None),
    shape: Optional[str] = Query(None),
    has_image: Optional[bool] = Query(None),
    deleted: bool = Query(False),
    drug_name: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    admin: dict = Depends(get_admin_user),
):
    if not database.db_engine:
        database.connect_to_database()

    filters = []
    params: dict = {"limit": per_page, "offset": (page - 1) * per_page}

    if deleted:
        filters.append("deleted_at IS NOT NULL")
    else:
        filters.append("deleted_at IS NULL")

    if q:
        filters.append("(LOWER(medicine_name) LIKE :q OR LOWER(splimprint) LIKE :q OR LOWER(ndc11) LIKE :q)")
        params["q"] = f"%{q.lower()}%"
    if color:
        filters.append("LOWER(splcolor_text) LIKE :color")
        params["color"] = f"%{color.lower()}%"
    if shape:
        filters.append("LOWER(splshape_text) LIKE :shape")
        params["shape"] = f"%{shape.lower()}%"
    if has_image is not None:
        if has_image:
            filters.append("has_image = 'TRUE'")
        else:
            filters.append("(has_image IS NULL OR has_image != 'TRUE')")
    if drug_name:
        filters.append("LOWER(medicine_name) LIKE :drug_name")
        params["drug_name"] = f"%{drug_name.lower()}%"

    where = "WHERE " + " AND ".join(filters) if filters else ""

    try:
        with database.db_engine.connect() as conn:
            count_row = conn.execute(
                text(f"SELECT COUNT(*) FROM pillfinder {where}"), params
            ).scalar()
            rows = conn.execute(
                text(f"""
                    SELECT id, medicine_name, splimprint, splcolor_text, splshape_text,
                           image_filename, has_image, slug, updated_at, deleted_at,
                           spl_strength, status_rx_otc
                    FROM pillfinder {where}
                    ORDER BY medicine_name NULLS LAST
                    LIMIT :limit OFFSET :offset
                """),
                params,
            ).fetchall()

        pills = []
        for r in rows:
            pills.append({
                "id": str(r[0]),
                "medicine_name": r[1],
                "splimprint": r[2],
                "splcolor_text": r[3],
                "splshape_text": r[4],
                "image_filename": r[5],
                "has_image": r[6],
                "slug": r[7],
                "updated_at": r[8].isoformat() if r[8] else None,
                "deleted_at": r[9].isoformat() if r[9] else None,
                "spl_strength": r[10],
                "status_rx_otc": r[11],
            })

        return {
            "pills": pills,
            "total": count_row,
            "page": page,
            "per_page": per_page,
            "pages": max(1, -(-count_row // per_page)),
        }
    except SQLAlchemyError as e:
        logger.error(f"list_pills DB error: {e}")
        raise HTTPException(status_code=500, detail="Database error")


@router.get("/{pill_id}")
def get_pill(pill_id: str, admin: dict = Depends(get_admin_user)):
    if not database.db_engine:
        database.connect_to_database()
    try:
        with database.db_engine.connect() as conn:
            row = conn.execute(
                text("SELECT * FROM pillfinder WHERE id = :id LIMIT 1"),
                {"id": pill_id},
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Pill not found")

            cols = row._fields if hasattr(row, "_fields") else row.keys()
            pill = {}
            for k, v in zip(cols, row):
                if hasattr(v, "isoformat"):
                    pill[k] = v.isoformat()
                else:
                    pill[k] = v

            # Include pending drafts
            drafts = conn.execute(
                text("""
                    SELECT id, status, created_at, updated_at, review_notes
                    FROM pill_drafts WHERE pill_id = :id AND status != 'published'
                    ORDER BY created_at DESC LIMIT 5
                """),
                {"id": pill_id},
            ).fetchall()
            pill["drafts"] = [
                {
                    "id": str(d[0]),
                    "status": d[1],
                    "created_at": d[2].isoformat() if d[2] else None,
                    "updated_at": d[3].isoformat() if d[3] else None,
                    "review_notes": d[4],
                }
                for d in drafts
            ]

        return pill
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"get_pill DB error: {e}")
        raise HTTPException(status_code=500, detail="Database error")


@router.post("", status_code=201)
def create_pill(
    request: Request,
    body: PillCreate,
    admin: dict = Depends(get_admin_user),
):
    if admin["role"] not in ("superadmin", "editor", "reviewer"):
        raise HTTPException(status_code=403, detail="Requires editor role or higher")

    if not database.db_engine:
        database.connect_to_database()

    data = {k: _sanitize(v) for k, v in body.model_dump(exclude={"idempotency_key"}).items() if v is not None}

    try:
        with database.db_engine.connect() as conn:
            if body.idempotency_key:
                existing = conn.execute(
                    text("SELECT id FROM pillfinder WHERE meta_description = :key LIMIT 1"),
                    {"key": body.idempotency_key},
                ).fetchone()
                if existing:
                    return {"id": str(existing[0]), "created": False}

            cols = ", ".join(data.keys())
            vals = ", ".join(f":{k}" for k in data.keys())
            result = conn.execute(
                text(f"INSERT INTO pillfinder ({cols}) VALUES ({vals}) RETURNING id"),
                data,
            )
            new_id = result.scalar()
            conn.commit()

            log_audit(
                conn,
                actor_id=admin["id"],
                actor_email=admin["email"],
                action="create",
                entity_type="pill",
                entity_id=str(new_id),
                diff={"after": data},
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )
            conn.commit()

        return {"id": str(new_id), "created": True}
    except SQLAlchemyError as e:
        logger.error(f"create_pill DB error: {e}")
        raise HTTPException(status_code=500, detail="Database error")


@router.put("/{pill_id}")
def update_pill(
    request: Request,
    pill_id: str,
    body: PillUpdate,
    admin: dict = Depends(get_admin_user),
):
    if admin["role"] not in ("superadmin", "editor", "reviewer"):
        raise HTTPException(status_code=403, detail="Requires editor role or higher")

    if not database.db_engine:
        database.connect_to_database()

    updates = {k: _sanitize(v) for k, v in body.model_dump(exclude={"idempotency_key", "updated_at"}).items() if v is not None}

    # Editors cannot modify critical fields; they must use the draft workflow
    if admin["role"] == "editor":
        critical_attempted = set(updates.keys()) & CRITICAL_FIELDS
        if critical_attempted:
            raise HTTPException(
                status_code=403,
                detail=f"Fields {critical_attempted} require reviewer role. Use draft workflow instead.",
            )

    try:
        with database.db_engine.connect() as conn:
            # Optimistic locking check
            current = conn.execute(
                text("SELECT updated_at FROM pillfinder WHERE id = :id AND deleted_at IS NULL LIMIT 1"),
                {"id": pill_id},
            ).fetchone()
            if not current:
                raise HTTPException(status_code=404, detail="Pill not found")

            if body.updated_at and current[0]:
                db_ts = current[0].replace(tzinfo=timezone.utc) if current[0].tzinfo is None else current[0]
                try:
                    client_ts = datetime.datetime.fromisoformat(body.updated_at.replace("Z", "+00:00"))
                    if abs((db_ts - client_ts).total_seconds()) > 1:
                        raise HTTPException(
                            status_code=409,
                            detail="Someone else edited this — refresh to see changes",
                        )
                except ValueError:
                    pass  # ignore malformed timestamp

            # Fetch before-snapshot for diff
            before_row = conn.execute(
                text("SELECT * FROM pillfinder WHERE id = :id LIMIT 1"), {"id": pill_id}
            ).fetchone()
            before_cols = before_row._fields if hasattr(before_row, "_fields") else before_row.keys()
            before = {k: str(v) if v is not None else None for k, v in zip(before_cols, before_row)}

            set_clause = ", ".join(f"{k} = :{k}" for k in updates.keys())
            set_clause += ", updated_at = now(), updated_by = :updated_by_id"
            updates["updated_by_id"] = str(admin["id"])
            updates["id"] = pill_id

            conn.execute(
                text(f"UPDATE pillfinder SET {set_clause} WHERE id = :id"),
                updates,
            )
            conn.commit()

            log_audit(
                conn,
                actor_id=admin["id"],
                actor_email=admin["email"],
                action="update",
                entity_type="pill",
                entity_id=pill_id,
                diff={
                    "before": {k: before.get(k) for k in updates if k not in ("id", "updated_by_id")},
                    "after": {k: v for k, v in updates.items() if k not in ("id", "updated_by_id")},
                },
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )
            conn.commit()

        return {"updated": True}
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"update_pill DB error: {e}")
        raise HTTPException(status_code=500, detail="Database error")


@router.delete("/{pill_id}")
def soft_delete_pill(
    request: Request,
    pill_id: str,
    admin: dict = Depends(get_admin_user),
):
    if admin["role"] not in ("superadmin", "editor", "reviewer"):
        raise HTTPException(status_code=403, detail="Requires editor role or higher")

    if not database.db_engine:
        database.connect_to_database()

    try:
        with database.db_engine.connect() as conn:
            result = conn.execute(
                text("""
                    UPDATE pillfinder
                    SET deleted_at = now(), deleted_by = :deleted_by
                    WHERE id = :id AND deleted_at IS NULL
                    RETURNING id
                """),
                {"id": pill_id, "deleted_by": str(admin["id"])},
            )
            if not result.fetchone():
                raise HTTPException(status_code=404, detail="Pill not found or already deleted")
            conn.commit()

            log_audit(
                conn,
                actor_id=admin["id"],
                actor_email=admin["email"],
                action="delete",
                entity_type="pill",
                entity_id=pill_id,
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )
            conn.commit()

        return {"deleted": True}
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"soft_delete_pill DB error: {e}")
        raise HTTPException(status_code=500, detail="Database error")


@router.post("/{pill_id}/restore")
def restore_pill(
    request: Request,
    pill_id: str,
    admin: dict = Depends(get_admin_user),
):
    if admin["role"] not in ("superadmin", "editor", "reviewer"):
        raise HTTPException(status_code=403, detail="Requires editor role or higher")

    if not database.db_engine:
        database.connect_to_database()

    try:
        with database.db_engine.connect() as conn:
            result = conn.execute(
                text("""
                    UPDATE pillfinder
                    SET deleted_at = NULL, deleted_by = NULL, updated_at = now(), updated_by = :updated_by
                    WHERE id = :id AND deleted_at IS NOT NULL
                    RETURNING id
                """),
                {"id": pill_id, "updated_by": str(admin["id"])},
            )
            if not result.fetchone():
                raise HTTPException(status_code=404, detail="Pill not found or not deleted")
            conn.commit()

            log_audit(
                conn,
                actor_id=admin["id"],
                actor_email=admin["email"],
                action="restore",
                entity_type="pill",
                entity_id=pill_id,
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )
            conn.commit()

        return {"restored": True}
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"restore_pill DB error: {e}")
        raise HTTPException(status_code=500, detail="Database error")
