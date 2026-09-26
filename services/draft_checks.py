"""Checks the draft review screen runs on a pill before it is published (Admin -> Drafts -> Review).

compare_imprint(expected, side_reads)   does the photo show the imprint typed for the pill?
pronunciation_problem(name, text)       does "pronounced as" spell out this drug, or another one?

Both are cheap and pure, and forgiving on purpose: they point the publisher at a likely
mistake; the publisher decides.
"""
from __future__ import annotations

import re
from typing import Optional

_TOKEN = re.compile(r"[A-Z0-9]+")
# Letters an imprint reader takes for digits (and the other way round) on a pill.
_LOOKALIKE = str.maketrans("OQILSZBG", "00115286")


def imprint_tokens(value) -> list[str]:
    """"S;10" / "s 10" / "S-10" -> ["S", "10"]."""
    return _TOKEN.findall(str(value or "").upper())


def _same(a: list[str], b: list[str]) -> bool:
    """Same imprint however it is split into tokens or faces: "M366" = "M 366" = "366 / M"."""
    if not a or not b:
        return False
    blob_a, blob_b = "".join(a), "".join(b)
    return all(t in blob_b for t in set(a)) and all(t in blob_a for t in set(b))


def _lookalike(tokens: list[str]) -> list[str]:
    return [t.translate(_LOOKALIKE) for t in tokens]


def compare_imprint(expected: str, side_reads: list[str]) -> dict:
    """What the photo reads against the imprint typed for the pill.

    verdict: match       the same imprint
             close       the same once lookalikes are forgiven (0/O, 1/I, 5/S, 8/B ...): almost surely a misread
             partial     part of it, for example one face of two
             mismatch    none of it: probably another pill's photo
             unreadable  no imprint read on the photo
             no_imprint  the pill has no imprint typed, but the photo shows one
    read:    what the photo reads, faces separated by " / "
    """
    faces = [str(side).strip() for side in side_reads or [] if imprint_tokens(side)]
    read = " / ".join(faces)
    got = [t for face in faces for t in imprint_tokens(face)]
    exp = imprint_tokens(expected)
    if not got:
        return {"verdict": "unreadable", "read": ""}
    if not exp:
        return {"verdict": "no_imprint", "read": read}
    if _same(exp, got):
        return {"verdict": "match", "read": read}
    exp_l, got_l = _lookalike(exp), _lookalike(got)
    if _same(exp_l, got_l):
        return {"verdict": "close", "read": read}
    blob = "".join(got_l)
    # a token of two or more characters found on the photo is real evidence; a lone letter is not
    long_tokens = [t for t in set(exp_l) if len(t) > 1]
    if long_tokens:
        partial = any(t in blob for t in long_tokens)
    else:  # only single characters typed ("A", "B"): all of them must show
        partial = all(t in blob for t in set(exp_l))
    return {"verdict": "partial" if partial else "mismatch", "read": read}


# ---- "pronounced as" ---------------------------------------------------------------------------------

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
    return "other_name" if first_word < 0.6 and all_words < 0.6 else None
