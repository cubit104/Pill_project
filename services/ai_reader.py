"""Second imprint reader: a hosted vision model reads the two pill photos.

Our own reader (the TrOCR service on the iMac) always goes first. This one is a
safety net (Admin -> Settings -> "Second reader"):

    off       never called
    fallback  called only when our reader has no exact imprint match
    always    called on every read, for an honest side-by-side on live traffic;
              it still only decides the answer when our reader has no exact match

It returns imprint TEXT and nothing else. It is never asked for, and never
allowed to supply, a drug name: its tokens go through the same database matcher
as our reader's, so an imprint that is not in our catalogue can never be shown.

Provider: Google Gemini (GEMINI_API_KEY on Render; without the key the feature
is inert whatever the setting says). Measured 2026-09-17 on 19 reviewed phone
captures: our reader 10 exact, gemini-3.8-flash 14, gemini-3.1-pro-preview 15.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
from typing import Optional

import requests
from sqlalchemy import text

import database

logger = logging.getLogger(__name__)

MODES = ("off", "fallback", "always")
# model id -> ($ per 1M input tokens, $ per 1M output tokens). Google's list prices, 2026-09.
MODELS: dict[str, tuple[float, float]] = {
    "gemini-3.8-flash": (0.75, 3.75),
    "gemini-3.1-pro-preview": (2.00, 12.00),
}
DEFAULT_MODEL = "gemini-3.8-flash"
DEFAULT_DAILY_CAP = 1000
MAX_DAILY_CAP = 100_000
TIMEOUT_S = float(os.getenv("PILL_AI_TIMEOUT", "15"))
API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

PROMPT = (
    "You are a pill imprint reader. Image 1 is side 1 of ONE pill; image 2, when present, is side 2 of the same pill. "
    "Transcribe the imprint (embossed or printed letters, numbers, symbols) on each side exactly as marked, uppercase, "
    "tokens separated by single spaces (for example \"C 73\", \"93 318\", \"S10\"). If a side is blank, only a score "
    "line, a logo without letters, or unreadable, use an empty string. Do NOT name the drug and do not use knowledge of "
    "common pills to correct what you see; report only what is visible. "
    "Reply with JSON only: {\"side1\":\"...\",\"side2\":\"...\",\"confidence\":\"high|medium|low\"}"
)

# Admin -> Drafts -> Review: the catalogue photo a draft pill will be published with (one image; one face,
# both faces side by side, or a capsule), read to check it shows the imprint typed for the pill.
CATALOG_PROMPT = (
    "You are a pill imprint reader. The image is a product photo of ONE kind of pill: one face, both faces side "
    "by side, or a capsule. Transcribe the imprint (embossed, debossed or printed letters, numbers, symbols) "
    "exactly as marked, uppercase, tokens separated by single spaces (for example \"C 73\", \"93 318\", \"S10\"). "
    "side1 is the first face shown (left or top), side2 the other face when the photo shows two; a capsule's "
    "printing all goes in side1. If a face is blank, only a score line, a logo without letters, or unreadable, "
    "use an empty string. Do NOT name the drug and do not use knowledge of common pills to correct what you see; "
    "report only what is visible. "
    "Reply with JSON only: {\"side1\":\"...\",\"side2\":\"...\",\"confidence\":\"high|medium|low\"}"
)

_TOKEN_OK = re.compile(r"[^A-Z0-9./&+\-]")


def api_key() -> str:
    return os.getenv("GEMINI_API_KEY", "").strip()


def should_run(mode: str, reader_exact: bool) -> bool:
    """Whether to call the second reader for this identification."""
    if mode == "always":
        return True
    return mode == "fallback" and not reader_exact


def clean_side(value) -> str:
    """One side's transcription -> safe uppercase tokens (bounded, no prose, no odd characters)."""
    if not isinstance(value, str):
        return ""
    tokens = []
    for raw in value.upper().split()[:8]:
        tok = _TOKEN_OK.sub("", raw)[:12]
        if tok:
            tokens.append(tok)
    return " ".join(tokens)


def parse_reply(data: dict, model: str) -> Optional[dict]:
    """Gemini's response body -> {"tokens", "side_reads", "confidence", "cost_micros"}; None if unusable."""
    try:
        txt = data["candidates"][0]["content"]["parts"][0]["text"]
        obj = json.loads(txt)
    except (KeyError, IndexError, TypeError, ValueError):
        return None
    if isinstance(obj, list):
        obj = obj[0] if obj else {}
    if not isinstance(obj, dict):
        return None
    sides = [clean_side(obj.get("side1")), clean_side(obj.get("side2"))]
    side_reads = [s for s in sides if s]
    tokens = " ".join(side_reads).split()[:12]
    confidence = obj.get("confidence") if obj.get("confidence") in ("high", "medium", "low") else "low"
    usage = data.get("usageMetadata") or {}
    price_in, price_out = MODELS.get(model, MODELS[DEFAULT_MODEL])
    # Thinking tokens are billed as output.
    tokens_out = int(usage.get("candidatesTokenCount") or 0) + int(usage.get("thoughtsTokenCount") or 0)
    cost_micros = round(int(usage.get("promptTokenCount") or 0) * price_in + tokens_out * price_out)  # $1e-6 units
    return {"tokens": tokens, "side_reads": side_reads, "confidence": confidence, "cost_micros": cost_micros}


def calls_last_day() -> int:
    """How many identifications used the second reader in the last 24 h (the cost fuse counts these).

    Fails CLOSED: when the count cannot be read, the caller must not spend. A call we cannot
    count is also a call record_capture cannot store, so the cap would drift with every outage.
    """
    if not database.db_engine and not database.connect_to_database():
        logger.warning("second reader: no database, cannot count today's calls; skipping the call")
        return MAX_DAILY_CAP + 1
    try:
        with database.db_engine.connect() as conn:
            return int(conn.execute(
                text("SELECT count(*) FROM identify_feedback WHERE ai_cost_micros IS NOT NULL "
                     "AND created_at > now() - interval '1 day'")
            ).scalar() or 0)
    except Exception as e:  # column missing before the migration, DB hiccup: fail closed (no spend)
        logger.warning("second reader: cannot count today's calls, skipping the call: %s", e)
        return MAX_DAILY_CAP + 1


def read(photos: list[bytes], model: str, daily_cap: int) -> Optional[dict]:
    """Ask the second reader. Returns parse_reply()'s dict, or None when it is off-limits
    (no key, cap reached) or the call failed. Never raises: identification must not break."""
    if not api_key() or not photos:
        return None
    if calls_last_day() >= max(0, daily_cap):
        logger.warning("second reader: daily cap of %s reached, not calling", daily_cap)
        return None
    return _ask(PROMPT, photos, model)


def read_catalog_photo(photo: bytes, model: str) -> Optional[dict]:
    """Read the imprint on a draft pill's catalogue photo (JPEG bytes). Same reply as read(). No daily cap
    here: the review screen (routes/admin/draft_review.py) keeps its own. Never raises."""
    if not api_key() or not photo:
        return None
    return _ask(CATALOG_PROMPT, [photo], model)


def _ask(prompt: str, photos: list[bytes], model: str) -> Optional[dict]:
    """One call to the model with the prompt and up to two JPEG photos; parse_reply()'s dict, or None."""
    key = api_key()
    if model not in MODELS:
        model = DEFAULT_MODEL
    parts: list[dict] = [{"text": prompt}]
    for raw in photos[:2]:
        parts.append({"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(raw).decode()}})
    body = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0},
    }
    try:
        # The key travels in a header, never in the URL, so it cannot end up in logs.
        r = requests.post(API.format(model=model), headers={"x-goog-api-key": key}, json=body, timeout=TIMEOUT_S)
        if r.status_code != 200:
            logger.warning("second reader: HTTP %s %s", r.status_code, r.text[:160])
            return None
        return parse_reply(r.json(), model)
    except Exception as e:
        logger.warning("second reader unavailable: %s", e)
        return None
