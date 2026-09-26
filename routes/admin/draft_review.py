"""Draft review (Admin -> Drafts -> "Review one by one" and "Grid").

The publisher goes through the unpublished pills with each photo next to the imprint typed for it, "used for"
and "pronounced as", and publishes them (one by one, or several ticked in the grid) or flags them back.

GET  /api/admin/draft-review/queue                             unpublished pills in review order, with score and "used for"
GET  /api/admin/draft-review/cards?ids=a,b,...                 up to 50 pills for the grid
GET  /api/admin/draft-review/{pill_id}                         one pill: photos, fields, "used for", "pronounced as"
POST /api/admin/draft-review/{pill_id}/indication/medlineplus  fill "used for" from MedlinePlus (NIH), credited to it
GET  /api/admin/draft-review/{pill_id}/indication/label        the FDA label's "indications" text, to edit before saving
POST /api/admin/draft-review/{pill_id}/pronunciation           {pronunciation_text}: confirm "pronounced as", or save a fix
POST /api/admin/draft-review/{pill_id}/publish                 {updated_at}: publish; refused while "used for" is empty

The score is the pill editor's completeness score (routes/admin/field_schema.compute_completeness). Flags go
through /api/admin/pills/{id}/review-flags and a typed "used for" through /api/admin/pills/{id}/indication, as in
the pill editor. Publishing runs the editor's own "Save & publish" (routes/admin/pills.update_pill), so meta text,
IndexNow and the Drafts list behave exactly the same; the grid publishes its selection pill by pill through it.
"Pronounced as" confirmations are audit_log rows (action pronunciation_checked, the text in diff), so no table
was added for them.
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text

import database
from routes.admin import pills as admin_pills
from routes.admin.auth import log_audit, require_role
from routes.admin.field_schema import compute_completeness, validate_pill
from services.draft_checks import pronunciation_problem
from services.drug_indications import fetch_indications_from_openfda, truncate_indication, upsert_from_medlineplus
from services.drug_pronunciation import get_pronunciation_lookup_keys, pill_pronunciation_key, pill_pronunciations
from services.medlineplus import fetch_by_rxcui
from utils import IMAGE_BASE, split_image_filenames

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin/draft-review", tags=["admin-draft-review"])

REVIEWERS = ("superuser", "editor", "reviewer")
# Publishing is approving, as on the Drafts list (approve_drafts in the admin's permission matrix).
PUBLISHERS = ("superuser", "editor")
CARDS_MAX = 50
LABEL_TEXT_LIMIT = 600
LABEL_NAMES_TRIED = 2

_PILL_FIELDS = (
    "medicine_name", "brand_names", "spl_strength", "splimprint", "splcolor_text", "splshape_text", "splsize",
    "dosage_form", "route", "ndc11", "ndc9", "rxcui", "author", "status_rx_otc", "dea_schedule_name", "slug",
    "image_filename",
)
_LABEL_HEADING = re.compile(r"^\s*(?:\d+(?:\.\d+)?\s*)?indications?\s*(?:and|&)\s*usage\s*", re.IGNORECASE)


def _db():
    if not database.db_engine and not database.connect_to_database():
        raise HTTPException(status_code=500, detail="Database connection not available")
    return database.db_engine


def _iso(value) -> Optional[str]:
    return value.isoformat() if value is not None and hasattr(value, "isoformat") else value


def _photos(image_filename) -> list[str]:
    return [f"{IMAGE_BASE}/{name}" for name in split_image_filenames(image_filename or "")]


def _pill(conn, pill_id: uuid.UUID, columns: str):
    row = conn.execute(
        text(f"SELECT {columns} FROM pillfinder WHERE id = CAST(:id AS uuid) AND deleted_at IS NULL LIMIT 1"),
        {"id": str(pill_id)},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Pill not found")
    return row


# ---- "used for" and "pronounced as" -----------------------------------------------------------------------------

def _indication(conn, rxcui) -> Optional[dict]:
    if not rxcui:
        return None
    row = conn.execute(
        text("SELECT plain_text, source, source_url FROM drug_indications WHERE rxcui = :rxcui LIMIT 1"),
        {"rxcui": str(rxcui)},
    ).fetchone()
    if not row or not (row[0] or "").strip():
        return None
    return {"text": row[0], "source": row[1], "source_url": row[2]}


def _with_used_for(conn, rxcuis) -> set[str]:
    """The RxCUIs among these that have a "used for" text."""
    wanted = sorted({str(r) for r in rxcuis if r})
    if not wanted:
        return set()
    rows = conn.execute(
        text("SELECT rxcui FROM drug_indications WHERE rxcui = ANY(:rxcuis) AND btrim(coalesce(plain_text, '')) <> ''"),
        {"rxcuis": wanted},
    ).fetchall()
    return {str(r[0]) for r in rows}


def _last_checks(conn, keys) -> dict[str, tuple]:
    """The latest confirmation of each of these names: (by, at, the text confirmed)."""
    wanted = sorted({k for k in keys if k})
    if not wanted:
        return {}
    rows = conn.execute(
        text(
            "SELECT DISTINCT ON (entity_id) entity_id, actor_email, occurred_at, diff->>'pronunciation_text' "
            "FROM audit_log WHERE entity_type = 'drug_pronunciation' AND action = 'pronunciation_checked' "
            "AND entity_id = ANY(:keys) ORDER BY entity_id, occurred_at DESC"
        ),
        {"keys": wanted},
    ).fetchall()
    return {row[0]: (row[1], row[2], row[3]) for row in rows}


def _pronunciations(conn, pills: list[tuple]) -> list[dict]:
    """For each (medicine_name, rxcui): what "pronounced as" the pill shows, the name it is kept under (a brand
    pill's own, else the generic), whether it sounds like that name, and who last confirmed this exact text there."""
    resolved = pill_pronunciations(conn, pills)
    checks = _last_checks(conn, [r["key"] for r in resolved])
    out = []
    for (medicine_name, _), r in zip(pills, resolved):
        key, found = r["key"], r["found"] or {}
        said = found.get("pronunciation_text")
        shown_from = found.get("drug_name_matched")
        checked = checks.get(key) if key and said and shown_from == key else None
        confirmed = bool(checked and (checked[2] or "").strip() == said)
        out.append({
            "text": said,
            "source": found.get("source"),
            "key": key,
            # when not the key, the text is another name's (a brand pill without its own shows the generic's)
            "shown_from": shown_from,
            "audio_url": found.get("audio_url"),
            "problem": pronunciation_problem(key or medicine_name, said),
            "checked_by": checked[0] if confirmed else None,
            "checked_at": _iso(checked[1]) if confirmed else None,
        })
    return out


def _pronunciation(conn, medicine_name, rxcui) -> dict:
    return _pronunciations(conn, [(medicine_name, rxcui)])[0]


def _record_check(conn, admin: dict, key: str, said: str, request: Request) -> None:
    # Written directly rather than with log_audit, which swallows errors: this row IS the confirmation.
    conn.execute(
        text(
            "INSERT INTO audit_log (actor_id, actor_email, action, entity_type, entity_id, diff, ip_address, user_agent) "
            "VALUES (:actor_id, :actor_email, 'pronunciation_checked', 'drug_pronunciation', :key, CAST(:diff AS jsonb), "
            "CAST(:ip AS inet), :user_agent)"
        ),
        {
            "actor_id": str(admin["id"]),
            "actor_email": admin.get("email", ""),
            "key": key,
            "diff": json.dumps({"pronunciation_text": said}),
            "ip": request.client.host if request.client else None,
            "user_agent": request.headers.get("user-agent"),
        },
    )


# ---- endpoints ----------------------------------------------------------------------------------------------------

@router.get("/queue")
def review_queue(admin: dict = Depends(require_role(*REVIEWERS))):
    """Every unpublished pill in review order, with the editor's completeness score and whether it has a "used
    for" text. Pills of one drug come together: they share "used for" and "pronounced as"."""
    with _db().connect() as conn:
        rows = conn.execute(
            text(
                "SELECT p.*, f.missing AS flag_missing, f.flagged_at AS flag_at "
                "FROM pillfinder p LEFT JOIN pill_review_flags f ON f.pill_id = p.id "
                "WHERE p.published = false AND p.deleted_at IS NULL "
                "ORDER BY lower(coalesce(p.medicine_name, '')), p.spl_strength NULLS LAST, p.splimprint NULLS LAST, p.id"
            )
        ).mappings().fetchall()
        used_for = _with_used_for(conn, [r["rxcui"] for r in rows])
    items = [
        {
            "id": str(r["id"]), "medicine_name": r["medicine_name"], "strength": r["spl_strength"],
            "imprint": r["splimprint"], "flagged": r["flag_at"] is not None, "missing": list(r["flag_missing"] or []),
            "score": compute_completeness(dict(r))["score"], "used_for": str(r["rxcui"] or "") in used_for,
        }  # fmt: skip
        for r in rows
    ]
    return {"items": items, "total": len(items)}


@router.get("/cards")
def review_cards(
    ids: str = Query(..., description="comma-separated pill ids"), admin: dict = Depends(require_role(*REVIEWERS))
):
    """Up to CARDS_MAX pills for the grid: photo, imprint, score, "used for" and "pronounced as"."""
    try:
        wanted = [str(uuid.UUID(part.strip())) for part in ids.split(",") if part.strip()]
    except ValueError:
        raise HTTPException(status_code=422, detail="ids must be pill ids")
    if len(wanted) > CARDS_MAX:
        raise HTTPException(status_code=422, detail=f"At most {CARDS_MAX} pills at a time")
    cards: dict[str, dict] = {}
    with _db().connect() as conn:
        rows = conn.execute(
            text("SELECT * FROM pillfinder WHERE id = ANY(CAST(:ids AS uuid[])) AND deleted_at IS NULL"),
            {"ids": wanted},
        ).mappings().fetchall()
        used_for = _with_used_for(conn, [r["rxcui"] for r in rows])
        said = _pronunciations(conn, [(r["medicine_name"], r["rxcui"]) for r in rows])
        for r, pronunciation in zip(rows, said):
            cards[str(r["id"])] = {
                "id": str(r["id"]), "medicine_name": r["medicine_name"], "strength": r["spl_strength"],
                "imprint": r["splimprint"], "color": r["splcolor_text"], "shape": r["splshape_text"],
                "size": r["splsize"], "rxcui": r["rxcui"], "photo": next(iter(_photos(r["image_filename"])), None),
                "score": compute_completeness(dict(r))["score"], "used_for": str(r["rxcui"] or "") in used_for,
                "pronunciation": pronunciation, "published": bool(r["published"]), "updated_at": _iso(r["updated_at"]),
            }  # fmt: skip
    return {"cards": [cards[i] for i in wanted if i in cards]}


@router.get("/{pill_id}")
def review_item(pill_id: uuid.UUID, admin: dict = Depends(require_role(*REVIEWERS))):
    with _db().connect() as conn:
        row = _pill(conn, pill_id, "*")
        pill = dict(row._mapping)
        indication = _indication(conn, pill.get("rxcui"))
        pronunciation = _pronunciation(conn, pill.get("medicine_name"), pill.get("rxcui"))
        flags = conn.execute(
            text("SELECT missing, note, flagged_by, flagged_at FROM pill_review_flags WHERE pill_id = CAST(:id AS uuid)"),
            {"id": str(pill_id)},
        ).fetchone()
    return {
        "pill": {
            "id": str(pill_id),
            **{k: pill.get(k) for k in _PILL_FIELDS},
            "published": bool(pill.get("published")),
            "updated_at": _iso(pill.get("updated_at")),
        },
        "photos": _photos(pill.get("image_filename")),
        "score": compute_completeness(pill)["score"],
        # what the editor's "Save & publish" would warn about
        "warnings": validate_pill(pill, strict=True),
        "indication": indication,
        "pronunciation": pronunciation,
        "flags": (
            {"missing": list(flags[0] or []), "note": flags[1], "flagged_by": flags[2], "flagged_at": _iso(flags[3])}
            if flags
            else None
        ),
    }


@router.post("/{pill_id}/indication/medlineplus")
def indication_from_medlineplus(request: Request, pill_id: uuid.UUID, admin: dict = Depends(require_role(*REVIEWERS))):
    """Save MedlinePlus's "why is this medication prescribed" for the pill's RxCUI, credited to MedlinePlus
    (the same row the MedlinePlus backfill writes). A hand-written "used for" is never replaced."""
    with _db().connect() as conn:
        (rxcui,) = _pill(conn, pill_id, "rxcui")
    if not rxcui:
        raise HTTPException(status_code=400, detail="This pill has no RxCUI, so it cannot have a \"used for\" text")
    payload = fetch_by_rxcui(str(rxcui))
    if not payload or not (payload.get("plain_text") or "").strip():
        raise HTTPException(status_code=404, detail="MedlinePlus has nothing for this drug")
    with _db().begin() as conn:
        outcome = upsert_from_medlineplus(conn, str(rxcui), payload)
        if outcome == "skipped_manual":
            raise HTTPException(status_code=409, detail="A hand-written \"used for\" is saved for this drug; edit it instead")
        log_audit(
            conn,
            actor_id=admin["id"],
            actor_email=admin.get("email", ""),
            action="update_indication",
            entity_type="drug_indication",
            entity_id=str(rxcui),
            metadata={"source": "medlineplus", "via": "draft_review"},
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
        indication = _indication(conn, rxcui)
    return {"indication": indication}


@router.get("/{pill_id}/indication/label")
def indication_from_label(pill_id: uuid.UUID, admin: dict = Depends(require_role(*REVIEWERS))):
    """The FDA label's "Indications and usage", shortened, for the publisher to edit into plain words and save."""
    with _db().connect() as conn:
        medicine_name, rxcui = _pill(conn, pill_id, "medicine_name, rxcui")
        # generic name first (from the RxCUI), then the pill's own name: the names openFDA files labels under
        names = get_pronunciation_lookup_keys(conn, medicine_name, rxcui=rxcui)
    for name in names[:LABEL_NAMES_TRIED]:
        found = fetch_indications_from_openfda(name)
        said = _LABEL_HEADING.sub("", (found or {}).get("indications_text") or "").strip()
        if said:
            return {"text": truncate_indication(said, LABEL_TEXT_LIMIT), "searched": name}
    raise HTTPException(status_code=404, detail="No FDA label text found for this drug")


class PronunciationReview(BaseModel):
    pronunciation_text: str = Field(..., min_length=1, max_length=200)


@router.post("/{pill_id}/pronunciation")
def review_pronunciation(
    request: Request, pill_id: uuid.UUID, body: PronunciationReview, admin: dict = Depends(require_role(*REVIEWERS))
):
    """This "pronounced as" is right for the pill: confirm it, or save a fix. Either way it is kept under the
    pill's own name (pill_pronunciation_key: a brand pill's own, else the generic) and marked checked, so the
    next pill of it shows it checked."""
    said = body.pronunciation_text.strip()
    if not said:
        raise HTTPException(status_code=422, detail="Pronunciation is empty")
    with _db().begin() as conn:
        medicine_name, rxcui = _pill(conn, pill_id, "medicine_name, rxcui")
        key = pill_pronunciation_key(conn, medicine_name, rxcui=rxcui)
        if not key:
            raise HTTPException(status_code=400, detail="This pill has no drug name to save a pronunciation under")
        row = conn.execute(
            text("SELECT pronunciation_text FROM drug_pronunciations WHERE drug_name_lower = :key"), {"key": key}
        ).fetchone()
        before = (row[0] or "").strip() if row else None
        changed = before != said
        if changed:
            own_name = (medicine_name or "").strip()
            conn.execute(
                text(
                    "INSERT INTO drug_pronunciations (drug_name_lower, drug_name_display, pronunciation_text, source) "
                    "VALUES (:key, :display, :said, 'manual') "
                    "ON CONFLICT (drug_name_lower) DO UPDATE SET pronunciation_text = EXCLUDED.pronunciation_text, "
                    "source = 'manual', needs_review = false, updated_at = NOW()"
                ),
                {"key": key, "display": own_name if own_name.lower() == key else key.title(), "said": said},
            )
            log_audit(
                conn,
                actor_id=admin["id"],
                actor_email=admin.get("email", ""),
                action="update_pronunciation",
                entity_type="drug_pronunciation",
                entity_id=key,
                diff={"before": before, "after": said},
                metadata={"via": "draft_review"},
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )
        else:
            conn.execute(
                text("UPDATE drug_pronunciations SET needs_review = false WHERE drug_name_lower = :key"), {"key": key}
            )
        _record_check(conn, admin, key, said, request)
        pronunciation = _pronunciation(conn, medicine_name, rxcui)
    return {"pronunciation": pronunciation, "changed": changed}


class PublishRequest(BaseModel):
    # the pill's updated_at as the reviewer saw it: publishing fails if the team changed the pill since
    updated_at: Optional[str] = None


@router.post("/{pill_id}/publish")
def publish(
    request: Request,
    pill_id: uuid.UUID,
    body: PublishRequest,
    background_tasks: BackgroundTasks,
    admin: dict = Depends(require_role(*PUBLISHERS)),
):
    with _db().connect() as conn:
        published, rxcui = _pill(conn, pill_id, "published, rxcui")
        if published:
            raise HTTPException(status_code=409, detail="This pill is already published")
        if not _indication(conn, rxcui):
            raise HTTPException(status_code=409, detail="\"What it's used for\" is empty. Fill it in, then publish.")
    result = admin_pills.update_pill(
        request, str(pill_id), admin_pills.PillUpdate(updated_at=body.updated_at), background_tasks, publish=True, admin=admin
    )
    return {**result, "published": True}
