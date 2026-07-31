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
    _build_image_alt_text,
    _build_meta_description,
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
    def test_full_example_imprint_first(self):
        """Imprint-first format: {imprint} {drug} {strength} {color} {shape} - Pill Identifier."""
        result = _build_meta_title({
            "splcolor_text": "GRAY, BROWN",
            "splshape_text": "CAPSULE",
            "medicine_name": "NITROFURANTOIN, MACROCRYSTALS/Nitrofurantoin, Monohydrate",
            "spl_strength": "25 MG/75 MG",
            "splimprint": "MYLAN;3422;MYLAN;3422",
        })
        assert result == "MYLAN;3422;MYLAN;3422 Nitrofurantoin Macrocrystals 25 mg/75 mg Gray Brown Capsule - Pill Identifier"

    def test_empty_data_returns_empty_string(self):
        assert _build_meta_title({}) == ""

    def test_only_pill_suffix_not_enough(self):
        """When no meaningful fields are present the result must be ''."""
        assert _build_meta_title({"splcolor_text": "", "medicine_name": None}) == ""

    def test_no_imprint_fallback(self):
        """Without imprint: {color} {shape} {drug} {strength} - Pill Identifier."""
        result = _build_meta_title({
            "splcolor_text": "WHITE",
            "splshape_text": "ROUND",
            "medicine_name": "ASPIRIN",
            "spl_strength": "325 MG",
        })
        assert result == "White Round Aspirin 325 mg - Pill Identifier"
        assert "With Imprint" not in result

    def test_imprint_preserved_as_is(self):
        """splimprint must not be modified (case, punctuation preserved)."""
        result = _build_meta_title({
            "splcolor_text": "WHITE",
            "medicine_name": "ASPIRIN",
            "splimprint": "MYLAN;3422",
        })
        assert result.startswith("MYLAN;3422")
        assert "MYLAN;3422" in result

    def test_none_values_treated_as_empty(self):
        """With no imprint, falls back to color/shape/drug format."""
        result = _build_meta_title({
            "splcolor_text": None,
            "splshape_text": None,
            "medicine_name": "ASPIRIN",
            "spl_strength": None,
            "splimprint": None,
        })
        assert result == "Aspirin - Pill Identifier"

    def test_only_imprint_present_still_builds_title(self):
        """With only imprint: {imprint} Pill - Pill Identifier."""
        result = _build_meta_title({"splimprint": "ABC 123"})
        assert result == "ABC 123 Pill - Pill Identifier"

    def test_color_normalization_applied(self):
        result = _build_meta_title({"splcolor_text": "RED, BLUE", "medicine_name": "ADVIL"})
        assert "Red Blue" in result

    def test_shape_title_cased(self):
        result = _build_meta_title({"splshape_text": "OVAL", "medicine_name": "TYLENOL"})
        assert "Oval" in result

    def test_strength_lowercased(self):
        result = _build_meta_title({"medicine_name": "ASPIRIN", "spl_strength": "500 MG"})
        assert "500 mg" in result

    def test_suffix_always_present(self):
        result = _build_meta_title({"medicine_name": "ASPIRIN"})
        assert result.endswith("- Pill Identifier")

    def test_only_color_shape(self):
        """Color and shape only: {color} {shape} Pill - Pill Identifier."""
        result = _build_meta_title({"splcolor_text": "WHITE", "splshape_text": "OVAL"})
        assert result == "White Oval Pill - Pill Identifier"


# ---------------------------------------------------------------------------
# _build_image_alt_text
# ---------------------------------------------------------------------------

class TestBuildImageAltText:
    def test_full_example(self):
        """Format: {color} {shape} {drug} {strength} pill imprinted {imprint}."""
        result = _build_image_alt_text({
            "splcolor_text": "BLUE",
            "splshape_text": "CAPSULE",
            "medicine_name": "GAVRETO",
            "spl_strength": "100 MG",
            "splimprint": "C94",
        })
        assert result == "Blue Capsule Gavreto 100 mg pill imprinted C94"

    def test_no_imprint(self):
        result = _build_image_alt_text({
            "splcolor_text": "WHITE",
            "splshape_text": "OVAL",
            "medicine_name": "METFORMIN",
            "spl_strength": "500 MG",
        })
        assert result == "White Oval Metformin 500 mg pill"

    def test_only_imprint(self):
        result = _build_image_alt_text({"splimprint": "ABC 123"})
        assert result == "Pill imprinted ABC 123"

    def test_empty_data(self):
        assert _build_image_alt_text({}) == ""

    def test_color_only(self):
        result = _build_image_alt_text({"splcolor_text": "WHITE"})
        assert result == "White pill"


# ---------------------------------------------------------------------------
# _build_meta_description
# ---------------------------------------------------------------------------

class TestBuildMetaDescription:
    def test_full_example_brand_and_generic(self):
        """Brand + generic differ → 'Brand (generic)' in description."""
        result = _build_meta_description({
            "brand_names": "Gavreto",
            "medicine_name": "PRALSETINIB",
            "spl_strength": "100 MG",
            "splcolor_text": "BLUE",
            "splshape_text": "CAPSULE",
            "splimprint": "C94",
        })
        assert result == (
            "Discover Gavreto (pralsetinib) 100 mg \u2014 uses, dosage, side effects, and drug interactions."
            " Identify this blue capsule pill imprinted C94 with PillSeek."
        )

    def test_no_imprint(self):
        """Without imprint the identification sentence uses color+shape only."""
        result = _build_meta_description({
            "medicine_name": "METFORMIN",
            "spl_strength": "500 MG",
            "splcolor_text": "WHITE",
            "splshape_text": "OVAL",
        })
        assert result == (
            "Discover Metformin 500 mg \u2014 uses, dosage, side effects, and drug interactions."
            " Identify this white oval pill with PillSeek."
        )

    def test_generic_only_no_duplication(self):
        """When brand_names equals medicine_name (case-insensitive), no duplication."""
        result = _build_meta_description({
            "brand_names": "Metformin",
            "medicine_name": "METFORMIN",
            "spl_strength": "500 MG",
            "splimprint": "A 12",
        })
        # drugDisplay should be just "Metformin", not "Metformin (metformin)"
        assert "Metformin (metformin)" not in result
        assert result.startswith("Discover Metformin 500 mg")

    def test_long_text_truncated_at_word_boundary(self):
        """Result must be at most 155 chars and must not cut mid-word."""
        result = _build_meta_description({
            "brand_names": "Verylongbrandname",
            "medicine_name": "VERYLONGGENERICNAME",
            "spl_strength": "999 MG",
            "splcolor_text": "RED, WHITE, BLUE",
            "splshape_text": "CAPSULE",
            "splimprint": "LONGIMPRINT1234567890",
        })
        assert len(result) <= 155
        # Verify exact word-boundary truncation: full string → first 155 chars → cut back to last space
        full = (
            "Discover Verylongbrandname (verylonggenericname) 999 mg \u2014 uses, dosage, side effects, and drug interactions."
            " Identify this red white blue capsule pill imprinted LONGIMPRINT1234567890 with PillSeek."
        )
        truncated = full[:155]
        expected = truncated[:truncated.rfind(" ")]
        assert result == expected

    def test_empty_data_returns_empty_string(self):
        assert _build_meta_description({}) == ""

    def test_medicine_name_only(self):
        """Only medicine_name → uses it as drugDisplay."""
        result = _build_meta_description({"medicine_name": "ASPIRIN"})
        assert result.startswith("Discover Aspirin")

    def test_no_color_shape_with_imprint(self):
        """Without color/shape but with imprint → simpler identification sentence."""
        result = _build_meta_description({
            "medicine_name": "ASPIRIN",
            "splimprint": "BAYER",
        })
        assert "Identify this pill imprinted BAYER with PillSeek." in result
