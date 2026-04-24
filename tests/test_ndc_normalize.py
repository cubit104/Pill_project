"""Tests for the ndc_normalize module — every HIPAA NDC format variant."""

import pytest
from ndc_normalize import normalize_ndc_to_11, ndc11_to_ndc9


class TestNormalizeNdcTo11:
    # ------------------------------------------------------------------
    # Standard 3-segment hyphenated formats
    # ------------------------------------------------------------------

    def test_4_4_2_pads_labeler(self):
        """4-4-2 → prepend 0 to labeler segment."""
        assert normalize_ndc_to_11("1234-5678-90") == "01234-5678-90"

    def test_5_3_2_pads_product(self):
        """5-3-2 → prepend 0 to product segment."""
        assert normalize_ndc_to_11("12345-678-90") == "12345-0678-90"

    def test_5_4_1_pads_package(self):
        """5-4-1 → prepend 0 to package segment."""
        assert normalize_ndc_to_11("12345-6789-0") == "12345-6789-00"

    def test_5_4_2_unchanged(self):
        """5-4-2 → already canonical, returned as-is."""
        assert normalize_ndc_to_11("12345-6789-01") == "12345-6789-01"

    # ------------------------------------------------------------------
    # 11-digit string without hyphens → treat as canonical 5-4-2
    # ------------------------------------------------------------------

    def test_11_digits_no_hyphens(self):
        assert normalize_ndc_to_11("12345678901") == "12345-6789-01"

    def test_11_digits_leading_zero(self):
        assert normalize_ndc_to_11("00002140102") == "00002-1401-02"

    # ------------------------------------------------------------------
    # Whitespace stripping
    # ------------------------------------------------------------------

    def test_strips_leading_trailing_whitespace(self):
        assert normalize_ndc_to_11("  12345-6789-01  ") == "12345-6789-01"

    # ------------------------------------------------------------------
    # Real-world examples
    # ------------------------------------------------------------------

    def test_real_world_4_4_2(self):
        # Example labeler 0002-1401-02 stored without leading zero
        assert normalize_ndc_to_11("0002-1401-02") == "00002-1401-02"

    def test_real_world_5_4_1_openfda(self):
        # openFDA often returns 5-4-1 format (5-digit labeler, 4-digit product, 1-digit package)
        assert normalize_ndc_to_11("50458-0200-1") == "50458-0200-01"

    # ------------------------------------------------------------------
    # Invalid / ambiguous inputs → return None
    # ------------------------------------------------------------------

    def test_returns_none_for_empty_string(self):
        assert normalize_ndc_to_11("") is None

    def test_returns_none_for_none_input(self):
        assert normalize_ndc_to_11(None) is None  # type: ignore[arg-type]

    def test_returns_none_for_non_string(self):
        assert normalize_ndc_to_11(12345678901) is None  # type: ignore[arg-type]

    def test_returns_none_for_10_digits_no_hyphens(self):
        """10 digits without hyphens is ambiguous — cannot determine format."""
        assert normalize_ndc_to_11("1234567890") is None

    def test_returns_none_for_two_segment_product_ndc(self):
        """product_ndc (5-4) without package code → ambiguous."""
        assert normalize_ndc_to_11("12345-6789") is None

    def test_returns_none_for_alpha_characters(self):
        assert normalize_ndc_to_11("ABCDE-1234-56") is None

    def test_returns_none_for_wrong_segment_lengths(self):
        """e.g. 3-4-2 is not a known FDA format."""
        assert normalize_ndc_to_11("123-4567-89") is None

    def test_returns_none_for_junk(self):
        assert normalize_ndc_to_11("not-an-ndc") is None

    def test_returns_none_for_four_segments(self):
        assert normalize_ndc_to_11("12345-6789-01-02") is None


class TestNdc11ToNdc9:
    def test_extracts_9_digits(self):
        assert ndc11_to_ndc9("12345-6789-01") == "123456789"

    def test_returns_none_for_none(self):
        assert ndc11_to_ndc9(None) is None  # type: ignore[arg-type]

    def test_returns_none_for_empty(self):
        assert ndc11_to_ndc9("") is None

    def test_returns_none_for_wrong_length(self):
        assert ndc11_to_ndc9("12345-6789") is None

    def test_handles_no_hyphens_11_digits(self):
        assert ndc11_to_ndc9("12345678901") == "123456789"
