"""Admin duplicate detection and merge endpoints."""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

import database
from routes.admin.auth import get_admin_user, log_audit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/duplicates", tags=["admin-duplicates"])

# The 7 normalised fields used for duplicate detection
_NORM_FIELDS = [
    ("medicine_name", "norm_name"),
    ("spl_strength", "norm_strength"),
    ("splimprint", "norm_imprint"),
    ("splcolor_text", "norm_color"),
    ("splshape_text", "norm_shape"),
    ("author", "norm_author"),
    ("ndc11", "norm_ndc"),
]

_GROUP_SQL = """
    SELECT
      LOWER(TRIM(COALESCE(medicine_name,''))) as norm_name,
      LOWER(TRIM(COALESCE(spl_strength,''))) as norm_strength,
      LOWER(TRIM(COALESCE(splimprint,''))) as norm_imprint,
      LOWER(TRIM(COALESCE(splcolor_text,''))) as norm_color,
      LOWER(TRIM(COALESCE(splshape_text,''))) as norm_shape,
      LOWER(TRIM(COALESCE(author,''))) as norm_author,
      LOWER(TRIM(COALESCE(ndc11,''))) as norm_ndc,
      COUNT(*) as cnt
    FROM pillfinder
    WHERE deleted_at IS NULL
    GROUP BY 1,2,3,4,5,6,7
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
"""

# Variant without ORDER BY used for counting (avoids unnecessary sort work)
_GROUP_COUNT_SQL = """
    SELECT COUNT(*) as cnt FROM pillfinder
    WHERE deleted_at IS NULL
    GROUP BY
      LOWER(TRIM(COALESCE(medicine_name,''))),
      LOWER(TRIM(COALESCE(spl_strength,''))),
      LOWER(TRIM(COALESCE(splimprint,''))),
      LOWER(TRIM(COALESCE(splcolor_text,''))),
      LOWER(TRIM(COALESCE(splshape_text,''))),
      LOWER(TRIM(COALESCE(author,''))),
      LOWER(TRIM(COALESCE(ndc11,'')))
    HAVING COUNT(*) > 1
"""


class MergeRequest(BaseModel):
    keep_id: str
    discard_ids: list[str]


def _row_to_dict(row) -> dict:
    """Convert a SQLAlchemy row to a plain dict, serialising timestamps."""
    cols = row._fields if hasattr(row, "_fields") else row.keys()
    result = {}
    for k, v in zip(cols, row):
        result[k] = v.isoformat() if hasattr(v, "isoformat") else v
    return result


def _norm(value: Optional[str]) -> str:
    return (value or "").strip().lower()


@router.get("/count")
def count_duplicates(admin: dict = Depends(get_admin_user)):
    """Return the total number of duplicate groups (lightweight endpoint for sidebar badge)."""
    if not database.db_engine:
        database.connect_to_database()
    try:
        with database.db_engine.connect() as conn:
            total_groups = conn.execute(
                text(f"SELECT COUNT(*) FROM ({_GROUP_COUNT_SQL}) sub")
            ).scalar() or 0
        return {"total_groups": total_groups}
    except SQLAlchemyError as e:
        logger.error(f"count_duplicates DB error: {e}")
        raise HTTPException(status_code=500, detail="Database error")


@router.get("")
def list_duplicates(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    admin: dict = Depends(get_admin_user),
):
    """Return groups of duplicate pills based on 7 normalised fields."""
    if not database.db_engine:
        database.connect_to_database()

    offset = (page - 1) * per_page

    try:
        with database.db_engine.connect() as conn:
            # Total group count — use the unordered query to avoid unnecessary sort
            total_groups = conn.execute(
                text(f"SELECT COUNT(*) FROM ({_GROUP_COUNT_SQL}) sub")
            ).scalar() or 0

            # Paginated group keys
            group_rows = conn.execute(
                text(f"{_GROUP_SQL} LIMIT :limit OFFSET :offset"),
                {"limit": per_page, "offset": offset},
            ).fetchall()

            groups = []
            for g in group_rows:
                key = {
                    "medicine_name": g[0],
                    "spl_strength": g[1],
                    "splimprint": g[2],
                    "splcolor_text": g[3],
                    "splshape_text": g[4],
                    "author": g[5],
                    "ndc11": g[6],
                }
                count = g[7]

                # Fetch matching pill rows
                pill_rows = conn.execute(
                    text("""
                        SELECT * FROM pillfinder
                        WHERE deleted_at IS NULL
                          AND LOWER(TRIM(COALESCE(medicine_name,''))) = :norm_name
                          AND LOWER(TRIM(COALESCE(spl_strength,''))) = :norm_strength
                          AND LOWER(TRIM(COALESCE(splimprint,''))) = :norm_imprint
                          AND LOWER(TRIM(COALESCE(splcolor_text,''))) = :norm_color
                          AND LOWER(TRIM(COALESCE(splshape_text,''))) = :norm_shape
                          AND LOWER(TRIM(COALESCE(author,''))) = :norm_author
                          AND LOWER(TRIM(COALESCE(ndc11,''))) = :norm_ndc
                    """),
                    {
                        "norm_name": g[0],
                        "norm_strength": g[1],
                        "norm_imprint": g[2],
                        "norm_color": g[3],
                        "norm_shape": g[4],
                        "norm_author": g[5],
                        "norm_ndc": g[6],
                    },
                ).fetchall()

                groups.append({
                    "key": key,
                    "count": count,
                    "pills": [_row_to_dict(r) for r in pill_rows],
                })

        return {
            "total_groups": total_groups,
            "groups": groups,
            "page": page,
            "per_page": per_page,
        }
    except SQLAlchemyError as e:
        logger.error(f"list_duplicates DB error: {e}")
        raise HTTPException(status_code=500, detail="Database error")


@router.post("/merge")
def merge_duplicates(
    request: Request,
    body: MergeRequest,
    admin: dict = Depends(get_admin_user),
):
    """Merge duplicate pills: gap-fill kept pill from discards, soft-delete discards."""
    if admin["role"] not in ("superadmin", "editor", "reviewer"):
        raise HTTPException(status_code=403, detail="Requires editor role or higher")

    if not body.discard_ids:
        raise HTTPException(status_code=400, detail="discard_ids must not be empty")

    # Prevent keep_id from being accidentally included in discard_ids
    discard_ids = list(dict.fromkeys(
        did for did in body.discard_ids if did != body.keep_id
    ))
    if not discard_ids:
        raise HTTPException(status_code=400, detail="discard_ids must not be empty or equal to keep_id")

    if not database.db_engine:
        database.connect_to_database()

    # The 7 fields used for duplicate key comparison
    _KEY_COLS = ["medicine_name", "spl_strength", "splimprint", "splcolor_text",
                 "splshape_text", "author", "ndc11"]

    # All fields eligible for gap-fill (non-key metadata only)
    _GAP_FILL_COLS = [
        "brand_names", "splsize", "spl_ingredients",
        "spl_inactive_ing", "dosage_form", "route", "dea_schedule_name",
        "pharmclass_fda_epc", "ndc9", "rxcui", "rxcui_1", "status_rx_otc",
        "imprint_status", "slug", "meta_description", "image_filename", "has_image",
        "image_alt_text", "tags",
    ]

    try:
        with database.db_engine.begin() as conn:
            keep_row = conn.execute(
                text("SELECT * FROM pillfinder WHERE id = :id AND deleted_at IS NULL LIMIT 1"),
                {"id": body.keep_id},
            ).fetchone()
            if not keep_row:
                raise HTTPException(status_code=404, detail="keep_id pill not found")

            discard_rows = []
            for did in discard_ids:
                row = conn.execute(
                    text("SELECT * FROM pillfinder WHERE id = :id AND deleted_at IS NULL LIMIT 1"),
                    {"id": did},
                ).fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail=f"discard pill {did} not found")
                discard_rows.append(row)

            keep_dict = _row_to_dict(keep_row)

            # Validate that all 7 key fields match between keep and each discard
            for dr in discard_rows:
                dr_dict = _row_to_dict(dr)
                for col in _KEY_COLS:
                    if _norm(keep_dict.get(col)) != _norm(dr_dict.get(col)):
                        raise HTTPException(
                            status_code=400,
                            detail=f"Field '{col}' differs between keep pill and discard pill {dr_dict['id']}",
                        )

            # Gap-fill: for each null/empty field on keep, copy first non-empty value from discards
            copied_fields: list[str] = []
            gap_fills: dict = {}
            for col in _GAP_FILL_COLS:
                if col not in keep_dict:
                    continue
                keep_val = keep_dict.get(col)
                if keep_val is None or (isinstance(keep_val, str) and keep_val.strip() == ""):
                    for dr_dict in [_row_to_dict(d) for d in discard_rows]:
                        donor = dr_dict.get(col)
                        if donor is not None and (not isinstance(donor, str) or donor.strip()):
                            gap_fills[col] = donor
                            copied_fields.append(col)
                            break

            # Apply gap-fills to keep pill
            if gap_fills:
                set_clause = ", ".join(f"{k} = :{k}" for k in gap_fills)
                set_clause += ", updated_at = now()"
                gap_fills["keep_id"] = body.keep_id
                conn.execute(
                    text(f"UPDATE pillfinder SET {set_clause} WHERE id = :keep_id"),
                    gap_fills,
                )

            # Soft-delete all discard pills (use uuid[] cast to avoid type mismatch)
            conn.execute(
                text("""
                    UPDATE pillfinder
                    SET deleted_at = now(), deleted_by = :admin_id
                    WHERE id = ANY(CAST(:ids AS uuid[])) AND deleted_at IS NULL
                """),
                {"ids": discard_ids, "admin_id": str(admin["id"])},
            )

            log_audit(
                conn,
                actor_id=admin["id"],
                actor_email=admin["email"],
                action="merge",
                entity_type="pill",
                entity_id=body.keep_id,
                diff={
                    "kept_id": body.keep_id,
                    "discard_ids": discard_ids,
                    "copied_fields": copied_fields,
                },
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )

            # Return updated kept pill
            updated_row = conn.execute(
                text("SELECT * FROM pillfinder WHERE id = :id LIMIT 1"),
                {"id": body.keep_id},
            ).fetchone()
            return _row_to_dict(updated_row) if updated_row else {"id": body.keep_id}

    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"merge_duplicates DB error: {e}")
        raise HTTPException(status_code=500, detail="Database error")
