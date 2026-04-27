"""
Unit tests for the _build_meta_title helper and its normalization functions
in routes/admin/pills.py.
"""

import os
import sys
import pytest
from unittest.mock import MagicMock

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key")

# Stub out heavy module-level dependencies so we can import the pure helpers
# without a real database, pandas, or full FastAPI environment.
for _mod in (
    "database",
    "utils",
    "routes.admin.auth",
    "routes.admin.field_schema",
):
    sys.modules.setdefault(_mod, MagicMock())

from routes.admin.pills import (  # noqa: E402
    _build_meta_title,
    _normalize_color,
    _normalize_drug_name,
    _normalize_strength,
)


# ---------------------------------------------------------------------------
# _normalize_color
# ---------------------------------------------------------------------------

class TestNormalizeColor:
    def test_single_color_uppercased(self):
        assert _normalize_color("WHITE") == "White"

    def test_two_comma_separated_colors(self):
        assert _normalize_color("GRAY, BROWN") == "Gray Brown"

    def test_three_colors(self):
        assert _normalize_color("RED, WHITE, BLUE") == "Red White Blue"

    def test_extra_whitespace_around_tokens(self):
        assert _normalize_color("  GRAY ,  BROWN  ") == "Gray Brown"

    def test_empty_string(self):
        assert _normalize_color("") == ""

    def test_already_title_case(self):
        assert _normalize_color("Gray, Brown") == "Gray Brown"

    def test_trailing_comma_ignored(self):
        assert _normalize_color("WHITE,") == "White"


# ---------------------------------------------------------------------------
# _normalize_drug_name
# ---------------------------------------------------------------------------

class TestNormalizeDrugName:
    def test_all_caps_simple(self):
        assert _normalize_drug_name("ASPIRIN") == "Aspirin"

    def test_takes_part_before_slash(self):
        """Only the part before the first '/' is used."""
        assert _normalize_drug_name(
            "NITROFURANTOIN, MACROCRYSTALS/Nitrofurantoin, Monohydrate"
        ) == "Nitrofurantoin Macrocrystals"

    def test_no_slash_comma_separated(self):
        assert _normalize_drug_name("NITROFURANTOIN, MACROCRYSTALS") == "Nitrofurantoin Macrocrystals"

    def test_no_slash_no_comma(self):
        assert _normalize_drug_name("IBUPROFEN") == "Ibuprofen"

    def test_empty_string(self):
        assert _normalize_drug_name("") == ""

    def test_leading_trailing_whitespace(self):
        assert _normalize_drug_name("  ASPIRIN  ") == "Aspirin"

    def test_multiple_slashes_only_first_part_used(self):
        assert _normalize_drug_name("DRUG A/DRUG B/DRUG C") == "Drug A"


# ---------------------------------------------------------------------------
# _normalize_strength
# ---------------------------------------------------------------------------

class TestNormalizeStrength:
    def test_lowercases_units(self):
        assert _normalize_strength("25 MG") == "25 mg"

    def test_preserves_slash_separator(self):
        assert _normalize_strength("25 MG/75 MG") == "25 mg/75 mg"

    def test_mcg_unit(self):
        assert _normalize_strength("100MCG") == "100mcg"

    def test_ml_unit(self):
        assert _normalize_strength("5 ML") == "5 ml"

    def test_strips_whitespace(self):
        assert _normalize_strength("  25 MG  ") == "25 mg"

    def test_empty_string(self):
        assert _normalize_strength("") == ""

    def test_already_lowercase(self):
        assert _normalize_strength("25 mg") == "25 mg"


# ---------------------------------------------------------------------------
# _build_meta_title
# ---------------------------------------------------------------------------

class TestBuildMetaTitle:
    def test_full_example_from_problem_statement(self):
        """Canonical example from the problem statement."""
        result = _build_meta_title({
            "splcolor_text": "GRAY, BROWN",
            "splshape_text": "CAPSULE",
            "medicine_name": "NITROFURANTOIN, MACROCRYSTALS/Nitrofurantoin, Monohydrate",
            "spl_strength": "25 MG/75 MG",
            "splimprint": "MYLAN;3422;MYLAN;3422",
        })
        assert result == "Gray Brown Capsule Nitrofurantoin Macrocrystals 25 mg/75 mg Pill With Imprint MYLAN;3422;MYLAN;3422"

    def test_empty_data_returns_empty_string(self):
        assert _build_meta_title({}) == ""

    def test_only_pill_suffix_not_enough(self):
        """When no meaningful fields are present the result must be ''."""
        assert _build_meta_title({"splcolor_text": "", "medicine_name": None}) == ""

    def test_no_imprint_omits_with_imprint_clause(self):
        result = _build_meta_title({
            "splcolor_text": "WHITE",
            "splshape_text": "ROUND",
            "medicine_name": "ASPIRIN",
            "spl_strength": "325 MG",
        })
        assert result == "White Round Aspirin 325 mg Pill"
        assert "With Imprint" not in result

    def test_imprint_preserved_as_is(self):
        """splimprint must not be modified (case, punctuation preserved)."""
        result = _build_meta_title({
            "splcolor_text": "WHITE",
            "medicine_name": "ASPIRIN",
            "splimprint": "MYLAN;3422",
        })
        assert "With Imprint MYLAN;3422" in result

    def test_none_values_treated_as_empty(self):
        result = _build_meta_title({
            "splcolor_text": None,
            "splshape_text": None,
            "medicine_name": "ASPIRIN",
            "spl_strength": None,
            "splimprint": None,
        })
        assert result == "Aspirin Pill"

    def test_only_imprint_present_still_builds_title(self):
        result = _build_meta_title({"splimprint": "ABC 123"})
        assert result == "Pill With Imprint ABC 123"

    def test_color_normalization_applied(self):
        result = _build_meta_title({"splcolor_text": "RED, BLUE", "medicine_name": "ADVIL"})
        assert result.startswith("Red Blue")

    def test_shape_title_cased(self):
        result = _build_meta_title({"splshape_text": "OVAL", "medicine_name": "TYLENOL"})
        assert "Oval" in result

    def test_strength_lowercased(self):
        result = _build_meta_title({"medicine_name": "ASPIRIN", "spl_strength": "500 MG"})
        assert "500 mg" in result
