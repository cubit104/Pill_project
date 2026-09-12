"""Editorial review of camera-identification captures (the learning loop).

Every photo identification writes one identify_feedback row; with consent the
two photos are kept in the private bucket. Reviewers turn those rows into
training data here: confirm which pill it was, write down what is readable on
each photo, or throw the photos away when they are unusable.

GET    /api/admin/captures?status=unreviewed|reviewed|unusable&page&per_page
GET    /api/admin/captures/count            unreviewed captures with photos (sidebar badge)
GET    /api/admin/captures/export[?since=]  training manifest: one row per photo, signed URLs
GET    /api/admin/captures/{id}             detail with candidate pills
POST   /api/admin/captures/{id}/review      {chosen_slug, reviewed_label, side_labels} or {unusable: true}
POST   /api/admin/captures/{id}/reopen      back to the queue
DELETE /api/admin/captures/{id}             superuser: row and photos gone

Photos are never public: the API hands out short-lived signed URLs, and the
manifest's URLs live long enough for one Colab session.
"""

import json
import logging
import uuid
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import text

import database
from routes.admin.auth import log_audit, require_role, require_superuser
from services import user_photos
from utils import process_image_filenames

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin-captures"])

REVIEWERS = ("superuser", "editor", "reviewer")
EXPORTERS = ("superuser", "editor")
MAX_LABEL = 80

_HAS_PHOTOS = "(jsonb_typeof(photo_paths) = 'array' AND jsonb_array_length(photo_paths) > 0)"
_STATUS_SQL = {
    "unreviewed": f"reviewed = false AND {_HAS_PHOTOS}",
    "reviewed": f"reviewed = true AND {_HAS_PHOTOS}",
    "unusable": f"reviewed = true AND NOT {_HAS_PHOTOS}",
}
_COLUMNS = (
    "capture_id::text, created_at, imprint_read, tokens, attrs_guess, top_slugs, consent, "
    "photo_paths, verdict, chosen_slug, corrected_imprint, reviewed, reviewed_label, "
    "side_labels, reviewed_at, reviewed_by"
)


class Review(BaseModel):
    chosen_slug: str | None = Field(default=None, max_length=300)
    reviewed_label: str | None = Field(default=None, max_length=MAX_LABEL)
    side_labels: list[str] | None = None
    unusable: bool = False


def _db():
    if not database.db_engine and not database.connect_to_database():
        raise HTTPException(status_code=500, detail="Database connection not available")
    return database.db_engine


def _jsonish(value, default):
    """jsonb columns arrive parsed from Postgres, but tolerate raw strings too."""
    if value is None:
        return default
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return default
    return value


def _paths(value) -> list[str]:
    return [p for p in _jsonish(value, []) if isinstance(p, str)]


def _norm_label(value: str | None) -> str:
    return " ".join((value or "").split()).upper()[:MAX_LABEL]


def _iso(value) -> str | None:
    return value.isoformat() if isinstance(value, datetime) else (str(value) if value else None)


def _row_to_capture(row, urls: dict[str, str]) -> dict:
    paths = _paths(row[7])
    return {
        "capture_id": row[0],
        "created_at": _iso(row[1]),
        "imprint_read": row[2],
        "tokens": _jsonish(row[3], []),
        "attrs_guess": _jsonish(row[4], {}),
        "top_slugs": _jsonish(row[5], []),
        "consent": bool(row[6]),
        "photo_paths": paths,
        "photo_urls": [urls.get(p, "") for p in paths],
        "verdict": row[8],
        "chosen_slug": row[9],
        "corrected_imprint": row[10],
        "reviewed": bool(row[11]),
        "reviewed_label": row[12],
        "side_labels": _jsonish(row[13], None),
        "reviewed_at": _iso(row[14]),
        "reviewed_by": row[15],
    }


def _fetch_capture(conn, capture_id: uuid.UUID):
    row = conn.execute(
        text(f"SELECT {_COLUMNS} FROM identify_feedback WHERE capture_id = CAST(:id AS uuid)"),
        {"id": str(capture_id)},
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Capture not found")
    return row


def _pill_cards(conn, slugs: list[str], user_pick: str | None) -> dict[str, dict]:
    """Catalog details for candidate slugs, keyed by slug (missing pills are skipped)."""
    slugs = [s for s in dict.fromkeys(slugs) if s]
    if not slugs:
        return {}
    rows = conn.execute(
        text(
            "SELECT slug, medicine_name, splimprint, splcolor_text, splshape_text, spl_strength, image_filename "
            "FROM pillfinder WHERE deleted_at IS NULL AND slug = ANY(:slugs)"
        ),
        {"slugs": slugs},
    ).fetchall()
    cards = {}
    for r in rows:
        images = process_image_filenames(r[6] or "")["image_urls"]
        cards[r[0]] = {
            "slug": r[0],
            "medicine_name": r[1] or r[0].replace("-", " "),
            "splimprint": r[2] or "",
            "color": r[3] or "",
            "shape": r[4] or "",
            "strength": r[5] or "",
            "image_url": images[0] if images else None,
            "user_picked": r[0] == user_pick,
        }
    return cards


@router.get("/captures/count")
def count_captures(admin: dict = Depends(require_role(*REVIEWERS))):
    with _db().connect() as conn:
        n = conn.execute(text(f"SELECT count(*) FROM identify_feedback WHERE {_STATUS_SQL['unreviewed']}")).scalar()
    return {"count": int(n or 0)}


@router.get("/captures/export")
def export_captures(
    since: date | None = Query(default=None, description="Only captures reviewed on/after this day"),
    admin: dict = Depends(require_role(*EXPORTERS)),
):
    """Training manifest: one row per stored photo, same keys as ml/scripts/export_manifest.py.

    `imprint` is the per-photo label when the reviewer wrote one, otherwise the
    whole pill's imprint (flagged by `label_scope`). URLs are signed for 7 days.
    """
    has_photos = _HAS_PHOTOS.replace("photo_paths", "f.photo_paths")
    where = f"f.reviewed = true AND {has_photos} AND (f.chosen_slug IS NOT NULL OR f.reviewed_label IS NOT NULL)"
    params: dict = {}
    if since:
        where += " AND f.reviewed_at >= :since"
        params["since"] = since
    with _db().connect() as conn:
        rows = conn.execute(
            text(
                "SELECT f.capture_id::text, f.created_at, f.photo_paths, f.chosen_slug, f.reviewed_label, "
                "f.side_labels, f.reviewed_at, p.medicine_name, p.splimprint, p.splcolor_text, p.splshape_text "
                "FROM identify_feedback f "
                "LEFT JOIN pillfinder p ON p.slug = f.chosen_slug AND p.deleted_at IS NULL "
                f"WHERE {where} ORDER BY f.created_at"
            ),
            params,
        ).fetchall()

    urls = user_photos.sign_urls([p for r in rows for p in _paths(r[2])], user_photos.EXPORT_TTL_S)
    manifest = []
    for r in rows:
        sides = _jsonish(r[5], None)
        pill_imprint = r[4] if r[4] is not None else _norm_label(r[8])
        for i, path in enumerate(_paths(r[2])):
            url = urls.get(path)
            if not url:
                continue
            per_side = isinstance(sides, list) and i < len(sides) and isinstance(sides[i], str)
            manifest.append(
                {
                    "url": url,
                    "slug": r[3] or "",
                    "imprint": _norm_label(sides[i]) if per_side else pill_imprint,
                    "color": (r[9] or "").strip(),
                    "shape": (r[10] or "").strip(),
                    "name": (r[7] or "").strip(),
                    "source": "phone",
                    "label_scope": "side" if per_side else "pill",
                    "pill_imprint": pill_imprint,
                    "capture_id": r[0],
                    "side": i + 1,
                    "path": path,
                    "captured_at": _iso(r[1]),
                    "reviewed_at": _iso(r[6]),
                }
            )
    filename = f"captures_manifest_{date.today().isoformat()}.json"
    return Response(
        content=json.dumps(manifest),
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Manifest-Rows": str(len(manifest)),
            "X-Manifest-Captures": str(len(rows)),
        },
    )


@router.get("/captures")
def list_captures(
    status: str = Query(default="unreviewed", pattern="^(unreviewed|reviewed|unusable)$"),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
    admin: dict = Depends(require_role(*REVIEWERS)),
):
    where = _STATUS_SQL[status]
    with _db().connect() as conn:
        total = conn.execute(text(f"SELECT count(*) FROM identify_feedback WHERE {where}")).scalar() or 0
        rows = conn.execute(
            text(
                f"SELECT {_COLUMNS} FROM identify_feedback WHERE {where} "
                "ORDER BY created_at DESC LIMIT :limit OFFSET :offset"
            ),
            {"limit": per_page, "offset": (page - 1) * per_page},
        ).fetchall()
    paths = [p for r in rows for p in _paths(r[7])]
    urls = user_photos.sign_urls(paths) if paths else {}
    return {
        "captures": [_row_to_capture(r, urls) for r in rows],
        "total": int(total),
        "page": page,
        "per_page": per_page,
        "status": status,
    }


@router.get("/captures/{capture_id}")
def get_capture(capture_id: uuid.UUID, admin: dict = Depends(require_role(*REVIEWERS))):
    with _db().connect() as conn:
        row = _fetch_capture(conn, capture_id)
        capture = _row_to_capture(row, user_photos.sign_urls(_paths(row[7])))
        wanted = list(capture["top_slugs"]) + ([capture["chosen_slug"]] if capture["chosen_slug"] else [])
        cards = _pill_cards(conn, wanted, capture["chosen_slug"])
    capture["candidates"] = [cards[s] for s in capture["top_slugs"] if s in cards]
    capture["chosen"] = cards.get(capture["chosen_slug"]) if capture["chosen_slug"] else None
    return capture


@router.post("/captures/{capture_id}/review")
def review_capture(capture_id: uuid.UUID, payload: Review, admin: dict = Depends(require_role(*REVIEWERS))):
    with _db().begin() as conn:
        row = _fetch_capture(conn, capture_id)
        paths = _paths(row[7])

        if payload.unusable:
            if paths and not user_photos.delete_objects(paths):
                raise HTTPException(status_code=502, detail="Could not delete the photos from storage")
            conn.execute(
                text(
                    "UPDATE identify_feedback SET reviewed = true, photo_paths = '[]'::jsonb, "
                    "reviewed_label = NULL, side_labels = NULL, reviewed_at = now(), reviewed_by = :by "
                    "WHERE capture_id = CAST(:id AS uuid)"
                ),
                {"by": admin.get("email"), "id": str(capture_id)},
            )
            log_audit(conn, admin["id"], admin.get("email", ""), "capture_unusable", "capture",
                      str(capture_id), diff={"photos_deleted": len(paths)})
            return {"capture_id": str(capture_id), "reviewed": True, "unusable": True}

        if not paths:
            raise HTTPException(status_code=409, detail="This capture has no photos left to label")
        if payload.chosen_slug is None and payload.reviewed_label is None:
            raise HTTPException(status_code=422, detail="Pick the pill or write the imprint (or mark unusable)")

        catalog_imprint = None
        if payload.chosen_slug is not None:
            pill = conn.execute(
                text("SELECT splimprint FROM pillfinder WHERE deleted_at IS NULL AND slug = :slug LIMIT 1"),
                {"slug": payload.chosen_slug},
            ).fetchone()
            if pill is None:
                raise HTTPException(status_code=404, detail="Unknown pill slug")
            catalog_imprint = _norm_label(pill[0])

        sides = None
        if payload.side_labels is not None:
            if len(payload.side_labels) != len(paths):
                raise HTTPException(status_code=422, detail=f"side_labels needs one entry per photo ({len(paths)})")
            sides = [_norm_label(s) for s in payload.side_labels]

        # The whole pill's imprint: what the reviewer wrote, else the catalog's.
        label = _norm_label(payload.reviewed_label) if payload.reviewed_label is not None else catalog_imprint
        conn.execute(
            text(
                "UPDATE identify_feedback SET reviewed = true, chosen_slug = COALESCE(:slug, chosen_slug), "
                "reviewed_label = :label, side_labels = CAST(:sides AS jsonb), reviewed_at = now(), "
                "reviewed_by = :by WHERE capture_id = CAST(:id AS uuid)"
            ),
            {
                "slug": payload.chosen_slug,
                "label": label,
                "sides": json.dumps(sides) if sides is not None else None,
                "by": admin.get("email"),
                "id": str(capture_id),
            },
        )
        log_audit(conn, admin["id"], admin.get("email", ""), "capture_reviewed", "capture", str(capture_id),
                  diff={"chosen_slug": payload.chosen_slug, "reviewed_label": label, "side_labels": sides})
    return {
        "capture_id": str(capture_id),
        "reviewed": True,
        "chosen_slug": payload.chosen_slug or row[9],
        "reviewed_label": label,
        "side_labels": sides,
    }


@router.post("/captures/{capture_id}/reopen")
def reopen_capture(capture_id: uuid.UUID, admin: dict = Depends(require_role(*REVIEWERS))):
    with _db().begin() as conn:
        res = conn.execute(
            text(
                "UPDATE identify_feedback SET reviewed = false, reviewed_at = NULL, reviewed_by = NULL "
                f"WHERE capture_id = CAST(:id AS uuid) AND {_HAS_PHOTOS}"
            ),
            {"id": str(capture_id)},
        )
        if res.rowcount == 0:
            raise HTTPException(status_code=404, detail="Capture not found or has no photos to review")
        log_audit(conn, admin["id"], admin.get("email", ""), "capture_reopened", "capture", str(capture_id))
    return {"capture_id": str(capture_id), "reviewed": False}


@router.delete("/captures/{capture_id}")
def delete_capture(capture_id: uuid.UUID, admin: dict = Depends(require_superuser)):
    with _db().begin() as conn:
        row = _fetch_capture(conn, capture_id)
        paths = _paths(row[7])
        if paths and not user_photos.delete_objects(paths):
            raise HTTPException(status_code=502, detail="Could not delete the photos from storage")
        conn.execute(text("DELETE FROM identify_feedback WHERE capture_id = CAST(:id AS uuid)"), {"id": str(capture_id)})
        log_audit(conn, admin["id"], admin.get("email", ""), "capture_deleted", "capture", str(capture_id),
                  diff={"photos_deleted": len(paths)})
    return {"capture_id": str(capture_id), "deleted": True}
