from services.interaction_spl_extract import (
    extract_targeted_paragraph,
    _clean_spl_text,
    _extract_by_sentence,
)


def test_extract_targeted_paragraph_returns_only_matching_block():
    section_html = """
    <section>
      <h2 id="drug-interactions">Drug Interactions</h2>
      <h3>Warfarin</h3>
      <p>Warfarin may increase bleeding risk.</p>
      <h3>Proton Pump Inhibitors</h3>
      <p>Avoid concomitant use of omeprazole with clopidogrel.</p>
      <p>Omeprazole inhibits CYP2C19.</p>
      <h3>Aspirin</h3>
      <p>Aspirin interaction content.</p>
    </section>
    """
    result = extract_targeted_paragraph(section_html, {"omeprazole", "prilosec"})
    assert result is not None
    assert "Proton Pump Inhibitors" in result
    assert "omeprazole" in result.lower()
    assert "Warfarin" not in result
    assert "Aspirin interaction content" not in result


def test_extract_targeted_paragraph_returns_none_when_no_match():
    section_html = """
    <section>
      <p>No mention of counterpart medicine in this section.</p>
    </section>
    """
    assert extract_targeted_paragraph(section_html, {"clopidogrel"}) is None


def test_extract_targeted_paragraph_cleans_cross_references_and_section_numbers():
    section_html = """
    <section>
      <h3>7.2 CYP2C19 Inhibitors</h3>
      <p>( 7.1 ) Avoid concomitant use of omeprazole with clopidogrel [see Warnings and Precautions (5.1)] [see Clinical Pharmacology (12.3)].</p>
    </section>
    """
    result = extract_targeted_paragraph(section_html, {"omeprazole"})
    assert result is not None
    assert "7.2" not in result
    assert "( 7.1 )" not in result
    assert "[see" not in result.lower()
    assert "(12.3)" not in result
    assert "omeprazole" in result.lower()


def test_extract_targeted_paragraph_no_heading_prefers_dense_short_block():
    long_text = " ".join(["Overview text"] * 120) + " omeprazole"
    section_html = f"""
    <section>
      <p>{long_text}</p>
      <p>Avoid omeprazole with clopidogrel. Omeprazole inhibits CYP2C19.</p>
    </section>
    """
    result = extract_targeted_paragraph(section_html, {"omeprazole"})
    assert result is not None
    assert "Avoid omeprazole with clopidogrel" in result
    assert long_text not in result


def test_extract_targeted_paragraph_no_heading_uses_sentence_fallback_for_giant_blob():
    filler = " ".join(["General interaction overview without counterpart mention."] * 40)
    section_html = f"""
    <section>
      <p>{filler} Omeprazole reduces the antiplatelet effect of clopidogrel. Avoid concomitant use when possible. Continue monitoring for reduced efficacy. {filler}</p>
    </section>
    """
    result = extract_targeted_paragraph(section_html, {"omeprazole"})
    assert result is not None
    assert "omeprazole reduces the antiplatelet effect of clopidogrel" in result.lower()
    assert len(result) <= 300
    assert result[-1] in ".!?"


# ── New tests for tighter extraction rules ────────────────────────────────────

def test_cap_text_truncates_at_300_chars():
    """Text longer than 300 chars is capped at a sentence boundary ≤ 300 chars."""
    section_html = """
    <section>
      <p>Avoid concomitant use of clopidogrel with omeprazole or esomeprazole. In clinical studies, omeprazole was shown to reduce significantly the antiplatelet activity of clopidogrel when given concomitantly or 12 hours apart. This has been shown in multiple randomised trials with large patient populations across different dosing regimens and formulations.</p>
    </section>
    """
    result = extract_targeted_paragraph(section_html, {"omeprazole"})
    assert result is not None
    assert len(result) <= 300
    assert result[-1] in ".!?"


def test_extract_by_sentence_uses_2_sentence_window():
    """_extract_by_sentence default window is 2 sentences."""
    text = (
        "Sentence one about general stuff. "
        "Sentence two about omeprazole specifically. "
        "Sentence three as extra context. "
        "Sentence four unrelated. "
        "Sentence five unrelated."
    )
    result = _extract_by_sentence(text, {"omeprazole"})
    assert result is not None
    sentences = [s.strip() for s in result.split(".") if s.strip()]
    assert len(sentences) <= 2


def test_clean_spl_text_strips_drug_interactions_header():
    text = "7 DRUG INTERACTIONS\nAvoid omeprazole with clopidogrel."
    cleaned = _clean_spl_text(text)
    assert "DRUG INTERACTIONS" not in cleaned
    assert cleaned.startswith("Avoid")
    assert "omeprazole" in cleaned


def test_clean_spl_text_strips_subsection_colon_titles():
    text = "CYP2C19 Inducers:\nAvoid omeprazole with clopidogrel."
    cleaned = _clean_spl_text(text)
    assert "CYP2C19 Inducers:" not in cleaned
    assert "omeprazole" in cleaned


def test_clean_spl_text_strips_comma_separated_ref_groups():
    text = "Avoid concomitant use ( 7.4 , 7.5 , 7.6 ) of omeprazole with clopidogrel."
    cleaned = _clean_spl_text(text)
    assert "7.4" not in cleaned
    assert "7.5" not in cleaned
    assert "7.6" not in cleaned
    assert "omeprazole" in cleaned


def test_clean_spl_text_strips_standalone_section_refs():
    text = "Avoid use ( 7 ) of omeprazole with clopidogrel."
    cleaned = _clean_spl_text(text)
    assert "( 7 )" not in cleaned
    assert "omeprazole" in cleaned
