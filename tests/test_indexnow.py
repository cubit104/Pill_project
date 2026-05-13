from __future__ import annotations

import csv
import os
from pathlib import Path
from unittest.mock import Mock, patch

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key")

from scripts import backfill_medication_guide as backfill_script
from services.indexnow import (
    IndexNowSubmissionError,
    build_indexnow_payload,
    expand_backfill_report_urls,
    load_indexnow_config,
    read_urls_from_file,
    submit_indexnow_urls,
)
from services.medication_guide_backfill import BackfillSummary


def _config():
    return load_indexnow_config(
        {
            "INDEXNOW_KEY": "abc123",
            "SITE_URL": "https://pillseek.com/",
        }
    )


def test_load_indexnow_config_derives_key_location():
    config = _config()
    assert config.key == "abc123"
    assert config.host == "pillseek.com"
    assert config.site_url == "https://pillseek.com"
    assert config.key_location == "https://pillseek.com/abc123.txt"


def test_load_indexnow_config_requires_key():
    with pytest.raises(IndexNowSubmissionError, match="INDEXNOW_KEY"):
        load_indexnow_config({"SITE_URL": "https://pillseek.com"})


def test_build_indexnow_payload_dedupes_urls():
    config = _config()
    payload = build_indexnow_payload(
        config,
        [
            "https://pillseek.com/pill/example",
            "https://pillseek.com/pill/example",
            "https://pillseek.com/pill/example/medication-guide",
        ],
    )

    assert payload == {
        "host": "pillseek.com",
        "key": "abc123",
        "keyLocation": "https://pillseek.com/abc123.txt",
        "urlList": [
            "https://pillseek.com/pill/example",
            "https://pillseek.com/pill/example/medication-guide",
        ],
    }


def test_read_urls_from_file_skips_blank_lines_and_comments(tmp_path):
    path = tmp_path / "urls.txt"
    path.write_text(
        "\n# comment\nhttps://pillseek.com/pill/example\n\nhttps://pillseek.com/pill/example/medication-guide\n",
        encoding="utf-8",
    )

    assert read_urls_from_file(path) == [
        "https://pillseek.com/pill/example",
        "https://pillseek.com/pill/example/medication-guide",
    ]


def test_expand_backfill_report_urls_for_complete_report(tmp_path):
    report = tmp_path / "complete-20260512T171743Z.csv"
    with report.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["pill_id", "slug", "medicine_name"])
        writer.writeheader()
        writer.writerow({"pill_id": "1", "slug": "drug-one", "medicine_name": "Drug One"})
        writer.writerow({"pill_id": "2", "slug": "", "medicine_name": "Drug Two"})

    assert expand_backfill_report_urls(report, _config()) == [
        "https://pillseek.com/pill/drug-one",
        "https://pillseek.com/pill/drug-one/medication-guide",
        "https://pillseek.com/pill/drug-one/professional-information",
    ]


def test_submit_indexnow_urls_filters_other_hosts_and_posts_batches():
    response = Mock(status_code=200, text="")
    with patch("services.indexnow.requests.post", return_value=response) as post_mock:
        result = submit_indexnow_urls(
            [
                "https://pillseek.com/pill/example",
                "https://pillseek.com/pill/example",
                "https://example.com/elsewhere",
            ],
            config=_config(),
            batch_size=1,
        )

    assert result.total_urls == 1
    assert result.submitted_urls == 1
    assert result.skipped_urls == 1
    assert result.batches_attempted == 1
    payload = post_mock.call_args.kwargs["json"]
    assert payload["host"] == "pillseek.com"
    assert payload["key"] == "abc123"
    assert payload["keyLocation"] == "https://pillseek.com/abc123.txt"
    assert payload["urlList"] == ["https://pillseek.com/pill/example"]


def test_submit_indexnow_urls_raises_when_request_fails():
    response = Mock(status_code=500, text="bad")
    with patch("services.indexnow.requests.post", return_value=response):
        with pytest.raises(IndexNowSubmissionError, match="status 500"):
            submit_indexnow_urls(
                ["https://pillseek.com/pill/example"],
                config=_config(),
            )


def test_backfill_script_submit_indexnow_is_non_fatal(tmp_path):
    complete = tmp_path / "complete-20260512T171743Z.csv"
    partial = tmp_path / "partial-20260512T171743Z.csv"
    for path in (complete, partial):
        path.write_text("pill_id,slug\n", encoding="utf-8")

    summary = BackfillSummary(
        total_pills=1,
        processed=1,
        matched=1,
        complete=1,
        partial=0,
        not_found=0,
        skipped=0,
        errors=0,
        professional_found=1,
        medguide_found=1,
        boxed_warning_found=1,
        duration_seconds=1.0,
        report_paths={
            "complete": str(complete),
            "partial": str(partial),
            "not_found": str(tmp_path / "not_found.csv"),
            "errors": str(tmp_path / "errors.csv"),
            "skipped": str(tmp_path / "skipped.csv"),
            "would_fetch": str(tmp_path / "would_fetch.csv"),
        },
    )

    with patch("scripts.backfill_medication_guide.run_backfill", return_value=summary), patch(
        "scripts.backfill_medication_guide.submit_indexnow_urls_from_backfill_reports",
        side_effect=IndexNowSubmissionError("missing config"),
    ):
        assert backfill_script.main(["--limit", "1", "--report-dir", str(tmp_path), "--submit-indexnow"]) == 0
