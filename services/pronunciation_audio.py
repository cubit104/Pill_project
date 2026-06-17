"""Pronunciation audio service — Google Cloud TTS + Supabase Storage."""

from __future__ import annotations

import base64
import logging
import os
import time
from urllib.parse import quote

import requests
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

logger = logging.getLogger(__name__)

_TTS_ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize"
_TTS_VOICE_NAME = "en-US-Chirp3-HD-Puck"
_TTS_LANGUAGE_CODE = "en-US"
_AUDIO_ENCODING = "MP3"
_STORAGE_BUCKET = "pronunciation-audio"


def generate_audio(drug_name: str, max_retries: int = 2) -> bytes | None:
    """Call Google Cloud TTS REST API and return MP3 audio bytes.

    Uses the Chirp 3 HD voice ``en-US-Chirp3-HD-Puck``.  The drug *name*
    (e.g. "lisinopril") is passed directly as the synthesis input — not the
    phonetic text.  Returns ``None`` on failure.
    """
    api_key = os.environ.get("GOOGLE_TTS_API_KEY")
    if not api_key:
        logger.warning(
            "GOOGLE_TTS_API_KEY not set; skipping TTS generation for %r", drug_name
        )
        return None

    payload = {
        "input": {"text": drug_name},
        "voice": {
            "languageCode": _TTS_LANGUAGE_CODE,
            "name": _TTS_VOICE_NAME,
        },
        "audioConfig": {"audioEncoding": _AUDIO_ENCODING},
    }

    last_exc: Exception | None = None
    for attempt in range(1 + max_retries):
        try:
            response = requests.post(
                _TTS_ENDPOINT,
                params={"key": api_key},
                json=payload,
                timeout=30,
            )
            response.raise_for_status()
            audio_content_b64: str = response.json()["audioContent"]
            return base64.b64decode(audio_content_b64)
        except Exception as exc:
            last_exc = exc
            if attempt < max_retries:
                wait = 2 ** (attempt + 1)
                logger.info(
                    "TTS attempt %d failed for %r, retrying in %ds…",
                    attempt + 1,
                    drug_name,
                    wait,
                )
                time.sleep(wait)

    logger.warning(
        "TTS generation failed for %r after %d attempt(s): %s",
        drug_name,
        1 + max_retries,
        last_exc,
    )
    return None


def upload_audio_to_supabase(drug_name: str, audio_bytes: bytes) -> str | None:
    """Upload *audio_bytes* (MP3) to Supabase Storage and return the public URL.

    Bucket: ``pronunciation-audio``
    Path:   ``{drug_name_lower}.mp3``

    The bucket must exist before uploading.  If it does not exist, create it
    via the Supabase Management API before calling this function, or create it
    manually in the Supabase dashboard.

    Returns the public URL string, or ``None`` on failure.
    """
    supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not supabase_url or not service_key:
        logger.warning(
            "NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set; cannot upload audio for %r",
            drug_name,
        )
        return None

    slug = quote(drug_name.lower().strip(), safe="")
    file_path = f"{slug}.mp3"
    upload_url = f"{supabase_url}/storage/v1/object/{_STORAGE_BUCKET}/{file_path}"

    headers = {
        "Authorization": "Bearer " + service_key,
        "Content-Type": "audio/mpeg",
        "x-upsert": "true",
    }

    try:
        response = requests.post(
            upload_url,
            headers=headers,
            data=audio_bytes,
            timeout=30,
        )
        response.raise_for_status()
        public_url = (
            f"{supabase_url}/storage/v1/object/public/{_STORAGE_BUCKET}/{file_path}"
        )
        logger.info("Uploaded audio for %r → %s", drug_name, public_url)
        return public_url
    except Exception as exc:
        logger.warning("Supabase Storage upload failed for %r: %s", drug_name, exc)
        return None


def get_or_generate_audio(conn, drug_name: str) -> str | None:
    """Return the audio URL for *drug_name*, generating it if not yet cached.

    Steps:
    1. Look up ``drug_pronunciations.audio_url`` for this drug.  Return if set.
    2. Generate MP3 via Google Cloud TTS.
    3. Upload to Supabase Storage.
    4. Persist the public URL back to ``drug_pronunciations.audio_url``.
    5. Return the URL (or ``None`` if any step fails).
    """
    lower_name = drug_name.strip().lower()

    # --- Step 1: check cache ---
    try:
        row = conn.execute(
            text(
                """
                SELECT audio_url
                FROM drug_pronunciations
                WHERE drug_name_lower = :lower_name
                LIMIT 1
                """
            ),
            {"lower_name": lower_name},
        ).fetchone()
    except SQLAlchemyError as exc:
        err_msg = str(exc).lower()
        if "drug_pronunciations" in err_msg and (
            "does not exist" in err_msg or "no such table" in err_msg
        ):
            logger.debug("drug_pronunciations table not yet created: %s", exc)
        else:
            logger.warning(
                "audio_url lookup failed for %r: %s", drug_name, exc
            )
        return None

    if row is None:
        # No pronunciation row at all — cannot store audio URL.
        logger.debug("No drug_pronunciations row found for %r", drug_name)
        return None

    if row[0]:
        return str(row[0])

    # --- Step 2: generate audio ---
    audio_bytes = generate_audio(drug_name)
    if not audio_bytes:
        return None

    # --- Step 3: upload ---
    audio_url = upload_audio_to_supabase(drug_name, audio_bytes)
    if not audio_url:
        return None

    # --- Step 4: persist ---
    try:
        conn.execute(
            text(
                """
                UPDATE drug_pronunciations
                SET audio_url = :audio_url
                WHERE drug_name_lower = :lower_name
                """
            ),
            {"audio_url": audio_url, "lower_name": lower_name},
        )
    except SQLAlchemyError as exc:
        logger.warning(
            "Failed to persist audio_url for %r: %s", drug_name, exc
        )
        # Still return the URL — the audio was generated successfully.

    return audio_url
