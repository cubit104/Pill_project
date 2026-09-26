"""Draft review queue (Admin -> Drafts -> Review one by one).

The publisher goes through the unpublished pills one at a time: the photo next to the imprint typed for it,
what the photo actually reads, "used for" and "pronounced as", then publishes it or flags it back to the team.

GET  /api/admin/draft-review/queue                             unpublished pills in review order (drug, strength, imprint)
GET  /api/admin/draft-review/{pill_id}                         one pill: photos, fields, checks, any photo read already made
POST /api/admin/draft-review/{pill_id}/read-photo              the AI reader reads the photo; compared with the typed imprint
POST /api/admin/draft-review/{pill_id}/indication/medlineplus  fill "used for" from MedlinePlus (NIH), credited to it
GET  /api/admin/draft-review/{pill_id}/indication/label        the FDA label's "indications" text, to edit before saving
POST /api/admin/draft-review/{pill_id}/pronunciation           {pronunciation_text}: confirm "pronounced as", or save a fix
POST /api/admin/draft-review/{pill_id}/publish                 {updated_at}: publish; refused while "used for" is empty

Flags go through /api/admin/pills/{id}/review-flags and a typed "used for" through /api/admin/pills/{id}/indication,
as in the pill editor. Publishing runs the editor's own "Save & publish" (routes/admin/pills.update_pill), so meta
text, IndexNow and the Drafts list behave exactly the same.

A photo read costs about 0.2 cents (Gemini, GEMINI_API_KEY). Reads are kept in memory per pill and photo, so opening
a pill again costs nothing, and at most REVIEW_READS_PER_DAY are made a day. "Pronounced as" confirmations are
audit_log rows (action pronunciation_checked, the text in diff), so no table was added for them.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import uuid
from collections import OrderedDict
from datetime import date
from typing import Optional

import requests
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text

import database
from routes.admin import pills as admin_pills
from routes.admin.auth import log_audit, require_role
from routes.admin.field_schema import validate_pill
from routes.identify_feedback import _bounded_jpeg
from routes.site_settings import read_flags
from services import ai_reader
from services.draft_checks import compare_imprint, pronunciation_problem
from services.drug_indications import fetch_indications_from_openfda, truncate_indication, upsert_from_medlineplus
from services.drug_pronunciation import get_pronunciation, get_pronunciation_lookup_keys
from services.medlineplus import fetch_by_rxcui
from utils import IMAGE_BASE, split_image_filenames

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin/draft-review", tags=["admin-draft-review"])

REVIEWERS = ("superuser", "editor", "reviewer")
# Publishing is approving, as on the Drafts list (approve_drafts in the admin's permission matrix).
PUBLISHERS = ("superuser", "editor")
# The whole queue read twice over is about 1,200 reads (~$2.40); this caps a runaway loop, not normal use.
REVIEW_READS_PER_DAY = 1500
READ_CACHE_MAX = 3000
PHOTO_TIMEOUT_S = 15
LABEL_TEXT_LIMIT = 600
LABEL_NAMES_TRIED = 2

_PILL_FIELDS = (
    "medicine_name", "brand_names", "spl_strength", "splimprint", "splcolor_text", "splshape_text", "splsize",
    "dosage_form", "route", "ndc11", "ndc9", "rxcui", "author", "status_rx_otc", "dea_schedule_name", "slug",
    "image_filename",
)
_LABEL_HEADING = re.compile(r"^\s*(?:\d+(?:\.\d+)?\s*)?indications?\s*(?:and|&)\s*usage\s*", re.IGNORECASE)

_lock = threading.Lock()
_reads: OrderedDict[tuple[str, str, str], dict] = OrderedDict()
_spent: dict[date, int] = {}


def _db():
    if not database.db_engine and not database.connect_to_database():
        raise HTTPException(status_code=500, detail="Database connection not available")
    return database.db_engine


def _iso(value) -> Optional[str]:
    return value.isoformat() if value is not None and hasattr(value, "isoformat") else value


def _photo_names(image_filename) -> list[str]:
    return split_image_filenames(image_filename or "")


# ---- photo reads: remembered per pill + photo + model, and capped per day ---------------------------------------

def _remembered(key: tuple[str, str, str]) -> Optional[dict]:
    with _lock:
        found = _reads.get(key)
        if found is not None:
            _reads.move_to_end(key)
        return found


def _remember(key: tuple[str, str, str], value: dict) -> None:
    with _lock:
        _reads[key] = value
        _reads.move_to_end(key)
        while len(_reads) > READ_CACHE_MAX:
            _reads.popitem(last=False)


def _spend_one() -> bool:
    """Count one paid read against today's allowance; False when it is used up."""
    today = date.today()
    with _lock:
        for day in [d for d in _spent if d != today]:
            del _spent[day]
        if _spent.get(today, 0) >= REVIEW_READS_PER_DAY:
            return False
        _spent[today] = _spent.get(today, 0) + 1
        return True


def _read_key(pill_id: str, image_filename) -> Optional[tuple[str, str, str]]:
    names = _photo_names(image_filename)
    if not names:
        return None
    model = read_flags().get("ai_reader_model") or ai_reader.DEFAULT_MODEL
    return (pill_id, names[0], model)


def _photo_read(read: dict, imprint) -> dict:
    return {**compare_imprint(imprint or "", read["side_reads"]), "confidence": read["confidence"], "model": read["model"]}


def _photo_jpeg(name: str) -> bytes:
    """The pill's photo as a JPEG the model accepts (drafts are mostly AVIF, which it does not)."""
    try:
        r = requests.get(
            f"{IMAGE_BASE}/{name}", timeout=PHOTO_TIMEOUT_S, headers={"User-Agent": "PillSeek/1.0 (+https://pillseek.com)"}
        )
        r.raise_for_status()
        jpeg = _bounded_jpeg(r.content)
    except Exception as e:
        logger.warning("draft review: cannot fetch photo %s: %s", name, e)
        jpeg = None
    if not jpeg:
        from PIL import features

        if name.lower().endswith(".avif") and not features.check("avif"):
            raise HTTPException(status_code=503, detail="This server cannot read AVIF photos: it needs pillow 11.3 or newer")
        raise HTTPException(status_code=502, detail="Could not load this pill's photo")
    return jpeg


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


def _last_check(conn, key: str) -> Optional[tuple]:
    return conn.execute(
        text(
            "SELECT actor_email, occurred_at, diff->>'pronunciation_text' FROM audit_log "
            "WHERE entity_type = 'drug_pronunciation' AND entity_id = :key AND action = 'pronunciation_checked' "
            "ORDER BY occurred_at DESC LIMIT 1"
        ),
        {"key": key},
    ).fetchone()


def _pronunciation(conn, medicine_name, rxcui) -> dict:
    """What "pronounced as" the editor shows for this pill, where it came from, whether it sounds like the name
    it is saved under, and who last confirmed this exact text."""
    found = get_pronunciation(conn, medicine_name, rxcui=rxcui, include_meta=True) or {}
    said = found.get("pronunciation_text")
    key = found.get("drug_name_matched")
    checked = _last_check(conn, key) if key and said else None
    confirmed = bool(checked and (checked[2] or "").strip() == said)
    return {
        "text": said,
        "source": found.get("source"),
        "key": key,
        "audio_url": found.get("audio_url"),
        "problem": pronunciation_problem(key or medicine_name, said),
        "checked_by": checked[0] if confirmed else None,
        "checked_at": _iso(checked[1]) if confirmed else None,
    }


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


def _pill(conn, pill_id: uuid.UUID, columns: str):
    row = conn.execute(
        text(f"SELECT {columns} FROM pillfinder WHERE id = CAST(:id AS uuid) AND deleted_at IS NULL LIMIT 1"),
        {"id": str(pill_id)},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Pill not found")
    return row


# ---- endpoints ----------------------------------------------------------------------------------------------------

@router.get("/queue")
def review_queue(admin: dict = Depends(require_role(*REVIEWERS))):
    """Every unpublished pill in review order. Pills of one drug come together: they share "used for" and
    "pronounced as", so those are checked once."""
    with _db().connect() as conn:
        rows = conn.execute(
            text(
                "SELECT p.id::text, p.medicine_name, p.spl_strength, p.splimprint, f.missing, f.flagged_at "
                "FROM pillfinder p LEFT JOIN pill_review_flags f ON f.pill_id = p.id "
                "WHERE p.published = false AND p.deleted_at IS NULL "
                "ORDER BY lower(coalesce(p.medicine_name, '')), p.spl_strength NULLS LAST, p.splimprint NULLS LAST, p.id"
            )
        ).fetchall()
    items = [
        {
            "id": r[0], "medicine_name": r[1], "strength": r[2], "imprint": r[3],
            "flagged": r[5] is not None, "missing": list(r[4] or []),
        }  # fmt: skip
        for r in rows
    ]
    return {"items": items, "total": len(items)}


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
    key = _read_key(str(pill_id), pill.get("image_filename"))
    read = _remembered(key) if key else None
    return {
        "pill": {
            "id": str(pill_id),
            **{k: pill.get(k) for k in _PILL_FIELDS},
            "published": bool(pill.get("published")),
            "updated_at": _iso(pill.get("updated_at")),
        },
        "photos": [f"{IMAGE_BASE}/{name}" for name in _photo_names(pill.get("image_filename"))],
        # what the editor's "Save & publish" would warn about
        "warnings": validate_pill(pill, strict=True),
        "indication": indication,
        "pronunciation": pronunciation,
        "flags": (
            {"missing": list(flags[0] or []), "note": flags[1], "flagged_by": flags[2], "flagged_at": _iso(flags[3])}
            if flags
            else None
        ),
        "photo_read": _photo_read(read, pill.get("splimprint")) if read else None,
    }


@router.post("/{pill_id}/read-photo")
def read_photo(pill_id: uuid.UUID, admin: dict = Depends(require_role(*REVIEWERS))):
    """Have the AI reader read the pill's first photo and compare it with the imprint typed for it."""
    with _db().connect() as conn:
        imprint, image_filename = _pill(conn, pill_id, "splimprint, image_filename")
    key = _read_key(str(pill_id), image_filename)
    if key is None:
        raise HTTPException(status_code=409, detail="This pill has no photo")
    read = _remembered(key)
    if read is None:
        if not ai_reader.api_key():
            raise HTTPException(status_code=503, detail="The AI reader is off on this server (no GEMINI_API_KEY)")
        if not _spend_one():
            raise HTTPException(status_code=429, detail=f"Today's {REVIEW_READS_PER_DAY} photo reads are used up")
        result = ai_reader.read_catalog_photo(_photo_jpeg(key[1]), key[2])
        if result is None:
            raise HTTPException(status_code=502, detail="The AI reader did not answer; try again")
        read = {"side_reads": result["side_reads"], "confidence": result["confidence"], "model": key[2]}
        _remember(key, read)
    return _photo_read(read, imprint)


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
    """The text shown is right (confirm), or here is the right one (fix). Either way it is marked checked, and
    the next pill of the same drug shows it as checked."""
    said = body.pronunciation_text.strip()
    if not said:
        raise HTTPException(status_code=422, detail="Pronunciation is empty")
    with _db().begin() as conn:
        medicine_name, rxcui = _pill(conn, pill_id, "medicine_name, rxcui")
        current = get_pronunciation(conn, medicine_name, rxcui=rxcui, include_meta=True) or {}
        changed = not (current.get("drug_name_matched") and current.get("pronunciation_text") == said)
        if changed:
            # saved where the editor's "Pronunciation" box saves it: the pill's first lookup key
            keys = get_pronunciation_lookup_keys(conn, medicine_name, rxcui=rxcui)
            if not keys:
                raise HTTPException(status_code=400, detail="This pill has no drug name to save a pronunciation under")
            key = keys[0]
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
                diff={"before": current.get("pronunciation_text"), "after": said},
                metadata={"via": "draft_review"},
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )
        else:
            key = current["drug_name_matched"]
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
