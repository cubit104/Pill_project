"""Batch-generate TTS audio files for all drugs without an audio_url.

Usage::

    python scripts/batch_generate_audio.py [--dry-run] [--limit N] [--offset N] [--drug NAME]

Reads drug names from ``drug_pronunciations`` where ``audio_url IS NULL``,
generates an MP3 via Google Cloud TTS, uploads it to Supabase Storage, and
updates ``audio_url`` in the DB.  Prints progress every 50 drugs.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("batch_generate_audio")

# Allow running directly from the repo root or from the scripts/ directory.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

_RATE_LIMIT_DELAY = 0.2  # seconds between TTS API calls
_PROGRESS_INTERVAL = 50  # print summary every N drugs

_SELECT_PENDING = """
    SELECT drug_name_lower
    FROM drug_pronunciations
    WHERE audio_url IS NULL
    ORDER BY drug_name_lower
    OFFSET :offset
"""

_SELECT_PENDING_LIMITED = """
    SELECT drug_name_lower
    FROM drug_pronunciations
    WHERE audio_url IS NULL
    ORDER BY drug_name_lower
    LIMIT :limit OFFSET :offset
"""


def _parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description=(
            "Batch-generate TTS audio for drugs that are missing audio_url in drug_pronunciations."
        )
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Generate audio but do NOT upload or update the database.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        metavar="N",
        help="Process at most N drugs.",
    )
    parser.add_argument(
        "--offset",
        type=int,
        default=0,
        metavar="N",
        help="Skip the first N pending rows.",
    )
    parser.add_argument(
        "--drug",
        type=str,
        default=None,
        metavar="NAME",
        help="Process a single named drug (must exist in drug_pronunciations).",
    )
    return parser.parse_args(argv)


def main(argv=None):
    args = _parse_args(argv)

    from sqlalchemy import text

    from services.pronunciation_audio import generate_audio, upload_audio_to_supabase

    # Lazy-load database module so tests can patch env vars first.
    try:
        import database as db_module
    except Exception as exc:
        logger.error("DB setup failed: %s", exc)
        sys.exit(1)

    if not db_module.db_engine:
        if not db_module.connect_to_database():
            logger.error("Cannot connect to database. Aborting.")
            sys.exit(1)

    # --- Collect drug names to process ---
    if args.drug:
        drugs = [args.drug.strip().lower()]
    else:
        with db_module.db_engine.connect() as conn:
            sql = _SELECT_PENDING_LIMITED if args.limit is not None else _SELECT_PENDING
            params: dict = {"offset": args.offset}
            if args.limit is not None:
                params["limit"] = args.limit
            rows = conn.execute(text(sql), params).fetchall()
        drugs = [(row[0] or "").strip() for row in rows if (row[0] or "").strip()]

    if not drugs:
        print("No drugs pending audio generation.")
        sys.exit(0)

    total = len(drugs)
    print(f"Processing {total} drug(s)…")

    done = 0
    errors = 0
    skipped = 0

    for i, drug_name in enumerate(drugs, start=1):
        try:
            # Check if audio_url was already set (e.g. by a concurrent run).
            with db_module.db_engine.connect() as conn:
                row = conn.execute(
                    text(
                        "SELECT audio_url FROM drug_pronunciations "
                        "WHERE drug_name_lower = :n LIMIT 1"
                    ),
                    {"n": drug_name},
                ).fetchone()

            if row is None:
                logger.warning("No pronunciation row for %r — skipping", drug_name)
                skipped += 1
                print(f"↷ {drug_name} — no row in drug_pronunciations, skipped")
                continue

            if row[0]:
                skipped += 1
                print(f"↷ {drug_name} — already has audio_url, skipped")
                continue

            # Generate audio.
            audio_bytes = generate_audio(drug_name)
            if not audio_bytes:
                errors += 1
                print(f"✗ {drug_name} — TTS generation failed")
                time.sleep(_RATE_LIMIT_DELAY)
                continue

            if args.dry_run:
                done += 1
                print(f"✓ {drug_name} — {len(audio_bytes)} bytes (dry-run, not uploaded)")
                time.sleep(_RATE_LIMIT_DELAY)
                continue

            # Upload to Supabase Storage.
            audio_url = upload_audio_to_supabase(drug_name, audio_bytes)
            if not audio_url:
                errors += 1
                print(f"✗ {drug_name} — upload failed")
                time.sleep(_RATE_LIMIT_DELAY)
                continue

            # Persist URL.
            with db_module.db_engine.begin() as conn:
                conn.execute(
                    text(
                        "UPDATE drug_pronunciations SET audio_url = :url "
                        "WHERE drug_name_lower = :n"
                    ),
                    {"url": audio_url, "n": drug_name},
                )

            done += 1
            print(f"✓ {drug_name} → {audio_url}")

        except Exception as exc:
            logger.error("Processing failed for %r: %s", drug_name, exc)
            errors += 1
            print(f"✗ {drug_name} — error: {exc}")

        time.sleep(_RATE_LIMIT_DELAY)

        if i % _PROGRESS_INTERVAL == 0:
            print(
                f"\n[Progress {i}/{total}] Done: {done} | Skipped: {skipped} | Errors: {errors}\n"
            )

    print(
        f"\nFinished. Total: {total} | Done: {done} | Skipped: {skipped} | Errors: {errors}"
    )

    if errors > 0:
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main(sys.argv[1:])
