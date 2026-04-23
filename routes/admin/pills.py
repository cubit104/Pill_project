"""Admin pill management endpoints."""
import csv
import io
import json
import logging
import time
import datetime
from datetime import timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
import bleach

import database
from routes.admin.auth import get_admin_user, log_audit, CRITICAL_FIELDS
from routes.admin.field_schema import validate_pill, compute_completeness
from utils import get_image_url

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/pills", tags=["admin-pills"])

# In-memory cache for /stats
_stats_cache: dict = {"data": None, "expires": 0.0}

ALLOWED_TAGS: list = []  # strip all HTML

EDITABLE_FIELDS = [
    "medicine_name", "author", "brand_names", "splimprint", "splcolor_text", "splshape_text",
    "splsize", "spl_strength", "spl_ingredients", "spl_inactive_ing", "dosage_form",
    "route", "dea_schedule_name", "pharmclass_fda_epc", "ndc9", "ndc11", "rxcui",
    "rxcui_1", "status_rx_otc", "imprint_status", "slug", "meta_description",
    "image_filename", "has_image", "image_alt_text", "tags",
]


def _sanitize(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    if value == "":
        return None
    return bleach.clean(str(value), tags=ALLOWED_TAGS, strip=True)


class PillCreate(BaseModel):
    medicine_name: Optional[str] = None
    author: Optional[str] = None
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
    image_filename: Optional[str] = None
    image_alt_text: Optional[str] = None
    tags: Optional[str] = None
    idempotency_key: Optional[str] = None


class PillUpdate(PillCreate):
    updated_at: Optional[str] = None  # for optimistic locking


class BulkTagRequest(BaseModel):
    ids: list[str]
    tag: str
    mode: str = "add"  # "add" | "replace"


class BulkDeleteRequest(BaseModel):
    ids: list[str]


@router.get("")
def list_pills(
    request: Request,
    q: Optional[str] = Query(None),
    color: Optional[str] = Query(None),
    shape: Optional[str] = Query(None),
    has_image: Optional[bool] = Query(None),
    deleted: bool = Query(False),
    drug_name: Optional[str] = Query(None),
    no_name: Optional[bool] = Query(None),
    no_imprint: Optional[bool] = Query(None),
    no_ndc: Optional[bool] = Query(None),
    sort: Optional[str] = Query(None),
    completeness: Optional[str] = Query(None),
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
    if no_name:
        filters.append("(medicine_name IS NULL OR TRIM(medicine_name) = '')")
    if no_imprint:
        filters.append("(splimprint IS NULL OR TRIM(splimprint) = '')")
    if no_ndc:
        filters.append("(ndc11 IS NULL OR TRIM(ndc11) = '')")

    where = "WHERE " + " AND ".join(filters) if filters else ""

    # Sort order: recent = updated_at DESC; default = named pills first then alpha
    if sort == "recent":
        order_by = "updated_at DESC NULLS LAST"
    else:
        order_by = "CASE WHEN medicine_name IS NULL OR TRIM(medicine_name) = '' THEN 1 ELSE 0 END, LOWER(medicine_name)"

    try:
        with database.db_engine.connect() as conn:
            # When a completeness color filter is requested we must compute scores for all
            # matching rows in Python (there's no DB column for completeness).  To keep
            # pagination totals correct we skip the SQL LIMIT/OFFSET and handle paging
            # ourselves after filtering.  For normal requests we use efficient SQL paging.
            if completeness in ("red", "yellow", "green"):
                # Fetch all matching rows so we can filter by completeness in Python
                all_rows = conn.execute(
                    text(f"""
                        SELECT id, medicine_name, splimprint, splcolor_text, splshape_text,
                               image_filename, has_image, slug, updated_at, deleted_at,
                               spl_strength, status_rx_otc,
                               author, ndc9, ndc11, dosage_form, route, spl_ingredients,
                               spl_inactive_ing, dea_schedule_name, brand_names, splsize,
                               meta_description, pharmclass_fda_epc, rxcui, rxcui_1,
                               imprint_status, image_alt_text, tags
                        FROM pillfinder {where}
                        ORDER BY {order_by}
                    """),
                    {k: v for k, v in params.items() if k not in ("limit", "offset")},
                ).fetchall()
                rows = all_rows
                use_sql_paging = False
            else:
                count_row = conn.execute(
                    text(f"SELECT COUNT(*) FROM pillfinder {where}"), params
                ).scalar()
                rows = conn.execute(
                    text(f"""
                        SELECT id, medicine_name, splimprint, splcolor_text, splshape_text,
                               image_filename, has_image, slug, updated_at, deleted_at,
                               spl_strength, status_rx_otc,
                               author, ndc9, ndc11, dosage_form, route, spl_ingredients,
                               spl_inactive_ing, dea_schedule_name, brand_names, splsize,
                               meta_description, pharmclass_fda_epc, rxcui, rxcui_1,
                               imprint_status, image_alt_text, tags
                        FROM pillfinder {where}
                        ORDER BY {order_by}
                        LIMIT :limit OFFSET :offset
                    """),
                    params,
                ).fetchall()
                use_sql_paging = True

        pills = []
        for r in rows:
            image_filename = r[5]
            image_url: Optional[str] = None
            if r[6] == 'TRUE' and image_filename:
                url = get_image_url(image_filename)
                # get_image_url returns a placeholder URL when filename is empty;
                # only use it when we have a real filename.
                if not url.endswith("placeholder.jpg"):
                    image_url = url

            pill_data = {
                "id": str(r[0]),
                "medicine_name": r[1],
                "splimprint": r[2],
                "splcolor_text": r[3],
                "splshape_text": r[4],
                "image_filename": image_filename,
                "has_image": r[6],
                "image_url": image_url,
                "slug": r[7],
                "updated_at": r[8].isoformat() if r[8] else None,
                "deleted_at": r[9].isoformat() if r[9] else None,
                "spl_strength": r[10],
                "status_rx_otc": r[11],
                "author": r[12],
                "ndc9": r[13],
                "ndc11": r[14],
                "dosage_form": r[15],
                "route": r[16],
                "spl_ingredients": r[17],
                "spl_inactive_ing": r[18],
                "dea_schedule_name": r[19],
                "brand_names": r[20],
                "splsize": r[21],
                "meta_description": r[22],
                "pharmclass_fda_epc": r[23],
                "rxcui": r[24],
                "rxcui_1": r[25],
                "imprint_status": r[26],
                "image_alt_text": r[27],
                "tags": r[28],
            }
            comp = compute_completeness(pill_data)
            pill_data["completeness_score"] = comp["score"]
            pill_data["completeness_color"] = (
                "red" if comp["missing_required"] else
                ("yellow" if comp["needs_na_confirmation"] or comp["optional_empty"] else "green")
            )
            pills.append(pill_data)

        if not use_sql_paging:
            # Filter by completeness color, then paginate in Python so total/pages are accurate
            pills = [p for p in pills if p.get("completeness_color") == completeness]
            count_row = len(pills)
            offset = (page - 1) * per_page
            pills = pills[offset: offset + per_page]

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


@router.get("/stats")
def get_stats(admin: dict = Depends(get_admin_user)):
    """Return count stats for filter chips, cached for 60 seconds."""
    now = time.time()
    if _stats_cache["data"] is not None and now < _stats_cache["expires"]:
        return _stats_cache["data"]

    if not database.db_engine:
        database.connect_to_database()

    try:
        with database.db_engine.connect() as conn:
            row = conn.execute(
                text("""
                    SELECT
                      COUNT(*) as total,
                      COUNT(*) FILTER (WHERE has_image IS NULL OR has_image != 'TRUE') as no_image,
                      COUNT(*) FILTER (WHERE medicine_name IS NULL OR TRIM(medicine_name) = '') as no_name,
                      COUNT(*) FILTER (WHERE splimprint IS NULL OR TRIM(splimprint) = '') as no_imprint,
                      COUNT(*) FILTER (WHERE ndc11 IS NULL OR TRIM(ndc11) = '') as no_ndc
                    FROM pillfinder
                    WHERE deleted_at IS NULL
                """)
            ).fetchone()

        data = {
            "total": row[0],
            "no_image": row[1],
            "no_name": row[2],
            "no_imprint": row[3],
            "no_ndc": row[4],
        }
        _stats_cache["data"] = data
        _stats_cache["expires"] = now + 60.0
        return data
    except SQLAlchemyError as e:
        logger.error(f"get_stats DB error: {e}")
        raise HTTPException(status_code=500, detail="Database error")


@router.get("/recent")
def get_recent(
    limit: int = Query(10, ge=1, le=50),
    admin: dict = Depends(get_admin_user),
):
    """Return most recently updated non-deleted pills."""
    if not database.db_engine:
        database.connect_to_database()

    try:
        with database.db_engine.connect() as conn:
            rows = conn.execute(
                text("""
                    SELECT id, medicine_name, splimprint, spl_strength, updated_at, slug,
                           image_filename, has_image
                    FROM pillfinder
                    WHERE deleted_at IS NULL
                    ORDER BY updated_at DESC
                    LIMIT :limit
                """),
                {"limit": limit},
            ).fetchall()

        pills = []
        for r in rows:
            image_filename = r[6]
            image_url: Optional[str] = None
            if r[7] == 'TRUE' and image_filename:
                url = get_image_url(image_filename)
                if not url.endswith("placeholder.jpg"):
                    image_url = url
            pills.append({
                "id": str(r[0]),
                "medicine_name": r[1],
                "splimprint": r[2],
                "spl_strength": r[3],
                "updated_at": r[4].isoformat() if r[4] else None,
                "slug": r[5],
                "image_url": image_url,
            })
        return pills
    except SQLAlchemyError as e:
        logger.error(f"get_recent DB error: {e}")
        raise HTTPException(status_code=500, detail="Database error")


@router.get("/incomplete")
def get_incomplete_pills(
    tier: Optional[str] = Query(None),  # "required" | "required_or_na" | None (all)
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    admin: dict = Depends(get_admin_user),
):
    """Return paginated list of incomplete pills sorted by lowest completeness score."""
    allowed_tiers = {"required", "required_or_na"}
    if tier is not None and tier not in allowed_tiers:
        raise HTTPException(
            status_code=400,
            detail="Invalid tier. Expected one of: required, required_or_na.",
        )
    if not database.db_engine:
        database.connect_to_database()

    try:
        with database.db_engine.connect() as conn:
            rows = conn.execute(
                text("""
                    SELECT id, medicine_name, splimprint, splcolor_text, splshape_text,
                           has_image, slug, author, ndc9, ndc11, dosage_form, route,
                           spl_ingredients, spl_inactive_ing, dea_schedule_name,
                           status_rx_otc, brand_names, splsize, meta_description,
                           pharmclass_fda_epc, rxcui, rxcui_1, imprint_status,
                           image_alt_text, tags, spl_strength
                    FROM pillfinder
                    WHERE deleted_at IS NULL
                """),
            ).fetchall()

        results = []
        for r in rows:
            pill_data = {
                "id": str(r[0]),
                "medicine_name": r[1],
                "splimprint": r[2],
                "splcolor_text": r[3],
                "splshape_text": r[4],
                "has_image": r[5],
                "slug": r[6],
                "author": r[7],
                "ndc9": r[8],
                "ndc11": r[9],
                "dosage_form": r[10],
                "route": r[11],
                "spl_ingredients": r[12],
                "spl_inactive_ing": r[13],
                "dea_schedule_name": r[14],
                "status_rx_otc": r[15],
                "brand_names": r[16],
                "splsize": r[17],
                "meta_description": r[18],
                "pharmclass_fda_epc": r[19],
                "rxcui": r[20],
                "rxcui_1": r[21],
                "imprint_status": r[22],
                "image_alt_text": r[23],
                "tags": r[24],
                "spl_strength": r[25],
            }
            comp = compute_completeness(pill_data)

            if tier == "required" and not comp["missing_required"]:
                continue
            if tier == "required_or_na" and not comp["needs_na_confirmation"]:
                continue
            if tier is None and comp["score"] == 100:
                continue

            pill_data["completeness_score"] = comp["score"]
            pill_data["missing_required"] = comp["missing_required"]
            pill_data["needs_na_confirmation"] = comp["needs_na_confirmation"]
            results.append(pill_data)

        # Sort by lowest score first
        results.sort(key=lambda p: p["completeness_score"])

        total = len(results)
        offset = (page - 1) * per_page
        paginated = results[offset: offset + per_page]

        return {
            "pills": paginated,
            "total": total,
            "page": page,
            "per_page": per_page,
            "pages": max(1, -(-total // per_page)),
        }
    except SQLAlchemyError as e:
        logger.error(f"get_incomplete_pills DB error: {e}")
        raise HTTPException(status_code=500, detail="Database error")


@router.get("/export.csv")
def export_csv(
    request: Request,
    q: Optional[str] = Query(None),
    color: Optional[str] = Query(None),
    shape: Optional[str] = Query(None),
    has_image: Optional[bool] = Query(None),
    deleted: bool = Query(False),
    drug_name: Optional[str] = Query(None),
    no_name: Optional[bool] = Query(None),
    no_imprint: Optional[bool] = Query(None),
    no_ndc: Optional[bool] = Query(None),
    admin: dict = Depends(get_admin_user),
):
    """Streaming CSV export of pills matching the given filters."""
    if not database.db_engine:
        database.connect_to_database()

    filters = []
    params: dict = {}

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
    if no_name:
        filters.append("(medicine_name IS NULL OR TRIM(medicine_name) = '')")
    if no_imprint:
        filters.append("(splimprint IS NULL OR TRIM(splimprint) = '')")
    if no_ndc:
        filters.append("(ndc11 IS NULL OR TRIM(ndc11) = '')")

    where = "WHERE " + " AND ".join(filters) if filters else ""

    COLUMNS = [
        "id", "medicine_name", "splimprint", "spl_strength", "splcolor_text",
        "splshape_text", "ndc11", "ndc9", "author", "has_image", "image_filename",
        "tags", "image_alt_text", "updated_at", "deleted_at",
    ]

    filter_details = {
        "q": q, "color": color, "shape": shape, "has_image": has_image,
        "deleted": deleted, "drug_name": drug_name, "no_name": no_name,
        "no_imprint": no_imprint, "no_ndc": no_ndc,
    }

    # Get row count and write audit log BEFORE streaming starts so it is
    # recorded even if the client disconnects mid-download.
    try:
        with database.db_engine.begin() as conn:
            row_count = conn.execute(
                text(f"SELECT COUNT(*) FROM pillfinder {where}"), params
            ).scalar() or 0
            log_audit(
                conn,
                actor_id=admin["id"],
                actor_email=admin["email"],
                action="export_csv",
                entity_type="pill",
                entity_id="bulk",
                diff={"filters": filter_details, "row_count": row_count},
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )
    except SQLAlchemyError as e:
        logger.error(f"export_csv setup error: {e}")
        raise HTTPException(status_code=500, detail="Database error")

    def generate():
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(COLUMNS)
        yield buf.getvalue()
        buf.truncate(0)
        buf.seek(0)

        try:
            with database.db_engine.connect().execution_options(stream_results=True) as conn:
                result = conn.execute(
                    text(f"""
                        SELECT id, medicine_name, splimprint, spl_strength, splcolor_text,
                               splshape_text, ndc11, ndc9,
                               COALESCE(author, '') as author,
                               has_image, image_filename, tags, image_alt_text,
                               updated_at, deleted_at
                        FROM pillfinder {where}
                        ORDER BY medicine_name
                    """),
                    params,
                )
                for row in result:
                    writer.writerow([
                        str(row[0]) if row[0] is not None else "",
                        row[1] or "",
                        row[2] or "",
                        row[3] or "",
                        row[4] or "",
                        row[5] or "",
                        row[6] or "",
                        row[7] or "",
                        row[8] or "",
                        row[9] or "",
                        row[10] or "",
                        row[11] or "",
                        row[12] or "",
                        row[13].isoformat() if row[13] else "",
                        row[14].isoformat() if row[14] else "",
                    ])
                    yield buf.getvalue()
                    buf.truncate(0)
                    buf.seek(0)
        except SQLAlchemyError as e:
            logger.error(f"export_csv stream error: {e}")

    filename = f"pills-export-{datetime.date.today().isoformat()}.csv"
    return StreamingResponse(
        generate(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/bulk/tag", status_code=200)
def bulk_tag(
    request: Request,
    body: BulkTagRequest,
    admin: dict = Depends(get_admin_user),
):
    """Bulk tag pills by id. mode='add' appends, mode='replace' overwrites."""
    if admin["role"] not in ("superadmin", "editor", "reviewer"):
        raise HTTPException(status_code=403, detail="Requires editor role or higher")

    if len(body.ids) > 500:
        raise HTTPException(status_code=400, detail="Maximum 500 ids per request")
    if not body.ids:
        return {"updated": 0}

    tag = body.tag.strip()
    if not tag:
        raise HTTPException(status_code=400, detail="tag must not be empty")
    if body.mode not in ("add", "replace"):
        raise HTTPException(status_code=400, detail="mode must be 'add' or 'replace'")

    if not database.db_engine:
        database.connect_to_database()

    try:
        with database.db_engine.begin() as conn:
            if body.mode == "replace":
                result = conn.execute(
                    text("""
                        UPDATE pillfinder SET tags = :tags, updated_at = now()
                        WHERE id = ANY(CAST(:ids AS uuid[])) AND deleted_at IS NULL
                    """),
                    {"tags": tag, "ids": list(body.ids)},
                )
                updated_count = result.rowcount
            else:
                # "add" mode — deduplicate comma-separated tags
                rows = conn.execute(
                    text("SELECT id, tags FROM pillfinder WHERE id = ANY(CAST(:ids AS uuid[])) AND deleted_at IS NULL"),
                    {"ids": list(body.ids)},
                ).fetchall()
                updated_count = len(rows)
                for row in rows:
                    pill_id, existing_tags = row[0], row[1]
                    current = [t.strip() for t in (existing_tags or "").split(",") if t.strip()]
                    if tag not in current:
                        current.append(tag)
                    new_tags = ", ".join(current)
                    conn.execute(
                        text("UPDATE pillfinder SET tags = :tags, updated_at = now() WHERE id = :id"),
                        {"tags": new_tags, "id": pill_id},
                    )

            log_audit(
                conn,
                actor_id=admin["id"],
                actor_email=admin["email"],
                action="bulk_tag",
                entity_type="pill",
                entity_id="bulk",
                diff={"ids": list(body.ids), "tag": tag, "mode": body.mode},
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )

        return {"updated": updated_count}
    except SQLAlchemyError as e:
        logger.error(f"bulk_tag DB error: {e}")
        raise HTTPException(status_code=500, detail="Database error")


@router.post("/bulk/delete", status_code=200)
def bulk_delete(
    request: Request,
    body: BulkDeleteRequest,
    admin: dict = Depends(get_admin_user),
):
    """Soft-delete multiple pills in a single transaction."""
    if admin["role"] not in ("superadmin", "editor", "reviewer"):
        raise HTTPException(status_code=403, detail="Requires editor role or higher")

    if len(body.ids) > 500:
        raise HTTPException(status_code=400, detail="Maximum 500 ids per request")
    if not body.ids:
        return {"deleted": 0}

    if not database.db_engine:
        database.connect_to_database()

    try:
        with database.db_engine.begin() as conn:
            result = conn.execute(
                text("""
                    UPDATE pillfinder
                    SET deleted_at = now(), deleted_by = :admin_id
                    WHERE id = ANY(CAST(:ids AS uuid[])) AND deleted_at IS NULL
                """),
                {"ids": list(body.ids), "admin_id": str(admin["id"])},
            )
            deleted_count = result.rowcount

            log_audit(
                conn,
                actor_id=admin["id"],
                actor_email=admin["email"],
                action="bulk_delete",
                entity_type="pill",
                entity_id="bulk",
                diff={"ids": list(body.ids)},
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )

        return {"deleted": deleted_count}
    except SQLAlchemyError as e:
        logger.error(f"bulk_delete DB error: {e}")
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

            # Add resolved image URLs so the gallery can render without
            # guessing paths.  New-style uploads are stored under
            # {pill_id}/{filename} in Supabase Storage; legacy images live at
            # {filename} (root level).  We detect new-style uploads by the
            # naming convention used by the upload endpoint:
            # filename = f"{pill_id[:8]}-{timestamp}{ext}"
            from utils import IMAGE_BASE as _IMAGE_BASE
            raw_fn = pill.get("image_filename") or ""
            pill_prefix = str(pill_id)[:8] + "-"
            resolved_urls = []
            for fn in [f.strip() for f in raw_fn.split(",") if f.strip()]:
                if fn.startswith(pill_prefix):
                    resolved_urls.append(f"{_IMAGE_BASE}/{pill_id}/{fn}")
                else:
                    resolved_urls.append(f"{_IMAGE_BASE}/{fn}")
            pill["resolved_image_urls"] = resolved_urls

        return pill
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"get_pill DB error: {e}")
        raise HTTPException(status_code=500, detail="Database error")


@router.get("/{pill_id}/completeness")
def get_pill_completeness(pill_id: str, admin: dict = Depends(get_admin_user)):
    """Return completeness metrics for a specific pill."""
    if not database.db_engine:
        database.connect_to_database()
    try:
        with database.db_engine.connect() as conn:
            row = conn.execute(
                text("SELECT * FROM pillfinder WHERE id = :id AND deleted_at IS NULL LIMIT 1"),
                {"id": pill_id},
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Pill not found")

            cols = row._fields if hasattr(row, "_fields") else row.keys()
            pill = {k: v for k, v in zip(cols, row)}

        result = compute_completeness(pill)
        return result
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"get_pill_completeness DB error: {e}")
        raise HTTPException(status_code=500, detail="Database error")


@router.post("", status_code=201)
def create_pill(
    request: Request,
    body: PillCreate,
    publish: bool = Query(False),
    admin: dict = Depends(get_admin_user),
):
    if admin["role"] not in ("superadmin", "editor", "reviewer"):
        raise HTTPException(status_code=403, detail="Requires editor role or higher")

    if not database.db_engine:
        database.connect_to_database()

    data = {k: _sanitize(v) for k, v in body.model_dump(exclude={"idempotency_key"}).items() if v is not None}

    # Derive has_image from image_filename so the two columns stay in sync
    if "image_filename" in data:
        data["has_image"] = "TRUE" if data["image_filename"] else "FALSE"
    elif "image_filename" not in data:
        # image_filename not provided — don't touch has_image either
        pass

    # Validate only when publishing (strict=True); drafts allow partial data
    if publish:
        errors = validate_pill(data, strict=True)
        if errors:
            return JSONResponse(
                status_code=422,
                content={"detail": "Validation failed", "errors": errors},
            )

    try:
        with database.db_engine.begin() as conn:
            if body.idempotency_key:
                existing = conn.execute(
                    text("SELECT id FROM pillfinder WHERE idempotency_key = :key LIMIT 1"),
                    {"key": body.idempotency_key},
                ).fetchone()
                if existing:
                    return {"id": str(existing[0]), "created": False}

            if body.idempotency_key:
                data["idempotency_key"] = body.idempotency_key

            cols = ", ".join(data.keys())
            vals = ", ".join(f":{k}" for k in data.keys())
            result = conn.execute(
                text(f"INSERT INTO pillfinder ({cols}) VALUES ({vals}) RETURNING id"),
                data,
            )
            new_id = result.scalar()

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

        return {"id": str(new_id), "created": True}
    except SQLAlchemyError as e:
        logger.error(f"create_pill DB error: {e}")
        raise HTTPException(status_code=500, detail="Database error")


@router.put("/{pill_id}")
def update_pill(
    request: Request,
    pill_id: str,
    body: PillUpdate,
    publish: bool = Query(False),
    admin: dict = Depends(get_admin_user),
):
    if admin["role"] not in ("superadmin", "editor", "reviewer"):
        raise HTTPException(status_code=403, detail="Requires editor role or higher")

    if not database.db_engine:
        database.connect_to_database()

    # Use exclude_unset=True so that absent keys (not sent by client) are never
    # touched, while explicitly-sent null values are treated as "set to NULL".
    raw = body.model_dump(exclude_unset=True, exclude={"idempotency_key", "updated_at"})
    updates: Dict[str, Any] = {}
    for k, v in raw.items():
        if v is None:
            # Explicitly sent as null → clear the column
            updates[k] = None
        else:
            sanitized = _sanitize(v)
            updates[k] = sanitized  # _sanitize converts "" to None, clearing the column

    # Derive has_image server-side from image_filename so the two stay in sync.
    # We do this after sanitize so we see the final value (None means "cleared").
    if "image_filename" in updates:
        fn_val = updates["image_filename"]
        updates["has_image"] = "TRUE" if fn_val else "FALSE"

    if not updates:
        return {"updated": False}

    # Editors cannot modify critical fields; they must use the draft workflow
    if admin["role"] == "editor":
        critical_attempted = set(updates.keys()) & CRITICAL_FIELDS
        if critical_attempted:
            raise HTTPException(
                status_code=403,
                detail=f"Fields {critical_attempted} require reviewer role. Use draft workflow instead.",
            )

    # On publish, merge update fields with current DB values and validate the merged result
    if publish:
        try:
            with database.db_engine.connect() as conn:
                current_row = conn.execute(
                    text("SELECT * FROM pillfinder WHERE id = :id AND deleted_at IS NULL LIMIT 1"),
                    {"id": pill_id},
                ).fetchone()
                if not current_row:
                    raise HTTPException(status_code=404, detail="Pill not found")
                cols = current_row._fields if hasattr(current_row, "_fields") else current_row.keys()
                merged = {k: v for k, v in zip(cols, current_row)}
        except HTTPException:
            raise
        except SQLAlchemyError as e:
            logger.error(f"update_pill publish-fetch DB error: {e}")
            raise HTTPException(status_code=500, detail="Database error")
        merged.update(updates)
        errors = validate_pill(merged, strict=True)
        if errors:
            return JSONResponse(
                status_code=422,
                content={"detail": "Validation failed", "errors": errors},
            )

    try:
        with database.db_engine.begin() as conn:
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
        with database.db_engine.begin() as conn:
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
        with database.db_engine.begin() as conn:
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

        return {"restored": True}
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"restore_pill DB error: {e}")
        raise HTTPException(status_code=500, detail="Database error")
