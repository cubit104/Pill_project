"""Admin text sanitizers keep plain text plain: tags are stripped, and entities
are decoded so an imprint typed as "G&W 0555" is stored exactly like that
instead of "G&amp;W 0555" (which then grew to "&amp;amp;" on every re-save)."""
import os

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")

import pytest

from routes.admin import drafts, pills


@pytest.mark.parametrize("sanitize", [pills._sanitize, drafts._sanitize])
def test_ampersand_and_angle_brackets_survive(sanitize):
    assert sanitize("G&W 0555 100 mg") == "G&W 0555 100 mg"
    assert sanitize("ADVIL COLD & SINUS") == "ADVIL COLD & SINUS"
    assert sanitize("dose < 5 mg") == "dose < 5 mg"


@pytest.mark.parametrize("sanitize", [pills._sanitize, drafts._sanitize])
def test_tags_are_stripped_and_old_entities_decoded(sanitize):
    assert sanitize("<b>Bausch</b> &amp; Lomb") == "Bausch & Lomb"
    assert sanitize('<script>alert("x")</script>Procter & Gamble') == 'alert("x")Procter & Gamble'
    assert sanitize("") is None
    assert sanitize(None) is None
