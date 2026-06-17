"""Pronunciation API endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

import database
from services.drug_pronunciation import get_pronunciation
from services.pronunciation_audio import get_or_generate_audio

logger = logging.getLogger(__name__)

router = APIRouter(tags=["pronunciation"])


@router.get("/api/pronunciation/{drug_name}/audio")
def get_pronunciation_audio(drug_name: str):
    """Return text pronunciation and audio URL for *drug_name*.

    Response JSON::

        {
            "drug_name": "lisinopril",
            "audio_url": "https://…/pronunciation-audio/lisinopril.mp3",
            "pronunciation_text": "lyse in' oh pril"
        }

    * If the drug has no pronunciation record at all, returns **404**.
    * ``audio_url`` may be ``null`` if TTS generation is not configured or fails.
    * ``pronunciation_text`` may be ``null`` if not yet backfilled.
    """
    lower_name = drug_name.strip().lower()

    # Use a single transaction-aware connection for both reads and the
    # potential audio_url UPDATE inside get_or_generate_audio.
    with database.db_engine.begin() as conn:
        pronunciation_text = get_pronunciation(conn, drug_name)
        audio_url = get_or_generate_audio(conn, lower_name)

        # If both are still None, check whether the row exists at all.
        if pronunciation_text is None and audio_url is None:
            row = conn.execute(
                text(
                    "SELECT 1 FROM drug_pronunciations WHERE drug_name_lower = :n LIMIT 1"
                ),
                {"n": lower_name},
            ).fetchone()
            if row is None:
                return JSONResponse(
                    status_code=404,
                    content={"error": f"No pronunciation found for {drug_name!r}"},
                )

    return JSONResponse(
        content={
            "drug_name": lower_name,
            "audio_url": audio_url,
            "pronunciation_text": pronunciation_text,
        }
    )
