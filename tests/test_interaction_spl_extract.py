from services.interaction_spl_extract import extract_targeted_paragraph


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
