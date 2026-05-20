import os

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")

from routes.details import _normalize_ndc_digits


def test_normalizes_4_4_2_hyphenated():
    # Wegovy production case
    assert _normalize_ndc_digits("0169-4425-31") == "00169442531"


def test_normalizes_5_3_2_hyphenated():
    assert _normalize_ndc_digits("12345-678-90") == "12345067890"


def test_normalizes_5_4_1_hyphenated():
    assert _normalize_ndc_digits("12345-6789-0") == "12345678900"


def test_passes_through_canonical_5_4_2():
    assert _normalize_ndc_digits("12345-6789-01") == "12345678901"


def test_accepts_11_raw_digits():
    assert _normalize_ndc_digits("00169442531") == "00169442531"


def test_rejects_product_only_ndc():
    # No package code → ambiguous → None
    assert _normalize_ndc_digits("0169-4425") is None


def test_rejects_empty_and_none():
    assert _normalize_ndc_digits(None) is None
    assert _normalize_ndc_digits("") is None
    assert _normalize_ndc_digits("   ") is None
