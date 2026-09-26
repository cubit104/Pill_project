"""The "pronounced as" check on the draft review screen (Admin -> Drafts -> Review).

pronunciation_problem(name, text)   does "pronounced as" spell out this drug, or another one?

Cheap and pure, and forgiving on purpose: it points the publisher at a likely mistake; the publisher decides.
"""
from __future__ import annotations

import re
from typing import Optional

# Notes or labels pasted in with the pronunciation ("Syllables: ...", a bare "pronunciation").
_JUNK = re.compile(r"[:\n]|syllable|pronunc|breakdown|\bstress", re.IGNORECASE)
_SPELLING = (("ph", "f"), ("ch", "k"), ("th", "t"), ("ck", "k"), ("qu", "kw"), ("dg", "j"), ("gh", "g"))


def _skeleton(value: str) -> str:
    """The consonants of a word as it sounds, so a respelling and the name compare:
    "tuh-DAL-uh-fil" and "tadalafil" -> "tdlfl"; "ZES-tril" -> "strl"."""
    s = re.sub(r"[^a-z ]+", "", value.lower())
    s = re.sub(r"\bx", "z", s)  # Xanax: ZAN-aks
    for spelled, sound in _SPELLING:
        s = s.replace(spelled, sound)
    s = re.sub(r"c(?=[eiy])", "s", s)
    s = re.sub(r"g(?=[eiy])", "j", s)
    s = s.replace("c", "k").replace("q", "k").replace("x", "ks").replace("z", "s")
    s = re.sub(r"[aeiouyhw ]+", "", s)  # vowels, and the h/w/y respellings add ("uh", "oh", "ow", "eye")
    return re.sub(r"(.)\1+", r"\1", s)


def _common(a: str, b: str) -> int:
    """Length of the longest common subsequence."""
    prev = [0] * (len(b) + 1)
    for ca in a:
        cur = [0]
        for j, cb in enumerate(b):
            cur.append(prev[j] + 1 if ca == cb else max(prev[j + 1], cur[j]))
        prev = cur
    return prev[-1]


def pronunciation_problem(drug_name: Optional[str], text: Optional[str]) -> Optional[str]:
    """None when "pronounced as" sounds like `drug_name`. Otherwise why not:

    missing     nothing saved
    odd         notes pasted in with it ("Syllables: ...", "pronunciation")
    other_name  it spells out another name, most often the brand saved under the generic
                (lisinopril "ZES-tril") or the ingredient under a store brand's name
    """
    spoken = (text or "").strip()
    if not spoken:
        return "missing"
    if _JUNK.search(spoken):
        return "odd"
    name = drug_name or ""
    said, whole = _skeleton(spoken), _skeleton(name)
    words = [w for w in (_skeleton(w) for w in re.split(r"[\s,/-]+", name)) if w]
    if not said or not whole or not words:
        return None  # nothing to compare (digits only, one-letter names): no opinion
    # A salt spoken after the name ("met-FOR-min HIGH-dro-klor-ide") is fine; the drug's first word not being
    # spoken while most of the name is missing too is not.
    first_word = _common(said, words[0]) / len(words[0])
    all_words = _common(said, whole) / len(whole)
    # ...and the other way round: a short name is easily "spoken" by a longer, different one ("zestril" by
    # "lye-SIN-oh-pril"), so the start of what is said must be that name.
    head = said[: len(words[0]) + 1]
    starts_with_it = _common(head, words[0]) / len(head)
    return "other_name" if (first_word < 0.6 and all_words < 0.6) or starts_with_it < 0.6 else None
