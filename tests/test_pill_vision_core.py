"""Tests for the portable vision core.

No model and no index files are needed: the ONNX session is faked, so these
exercise the maths and the contracts the matcher service and the API both rely
on.
"""

import io

import numpy as np
import pytest
from PIL import Image

from services import pill_vision_core as core

DIM = 8


class _FakeSession:
    """Stands in for the encoder: a deterministic vector per image."""

    def __init__(self, dim=DIM):
        self.dim = dim
        self.calls = 0

    def run(self, _outputs, feed):
        self.calls += 1
        m = float(feed["image"].mean())
        v = np.array([np.sin(m * (i + 1) + i) for i in range(self.dim)], dtype=np.float32)
        return [v[np.newaxis, ...]]


def _index(n=6):
    """Six fingerprints over three pills, so slug dedupe has something to do."""
    rng = np.random.default_rng(0)
    vectors = rng.normal(size=(n, DIM)).astype(np.float32)
    vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
    meta = [{"slug": f"pill-{i // 2}"} for i in range(n)]
    index = core.VisionIndex(_FakeSession(), vectors, meta)
    index.blanks = [np.zeros(DIM, dtype=np.float32)]
    return index


def _jpeg(size=(200, 200), color=(200, 180, 160)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="JPEG")
    return buf.getvalue()


def test_run_model_returns_a_unit_vector():
    emb = core.run_model(_index(), Image.new("RGB", (224, 224), (128, 128, 128)))
    assert emb.shape == (DIM,)
    assert np.isclose(np.linalg.norm(emb), 1.0)


def test_rank_slugs_keeps_each_pill_once_at_its_best_score():
    index = _index()
    sims = np.array([0.1, 0.9, 0.5, 0.2, 0.3, 0.4])
    assert core.rank_slugs(index, sims, 3) == [("pill-0", 0.9), ("pill-1", 0.5), ("pill-2", 0.4)]


def test_rank_slugs_respects_the_limit():
    assert len(core.rank_slugs(_index(), np.array([0.1, 0.9, 0.5, 0.2, 0.3, 0.4]), 2)) == 2


def test_match_uses_one_side_alone_for_a_single_photo(monkeypatch):
    index = _index()
    only = np.array([1.0, 0.0, 0.0, 0.0, 0.0, 0.0])
    monkeypatch.setattr(core, "side_sims", lambda idx, raw: (only, "crop"))
    assert core.match(index, [_jpeg()], 3)[0] == ("pill-0", 1.0)


def test_match_blends_both_sides_with_the_documented_weights(monkeypatch):
    index = _index()
    a = np.array([1.0, 0, 0, 0, 0, 0])
    b = np.array([0, 1.0, 0, 0, 0, 0])
    pair = np.array([0, 0, 1.0, 0, 0, 0])
    sides = iter([(a, "cropA"), (b, "cropB")])
    monkeypatch.setattr(core, "side_sims", lambda idx, raw: next(sides))
    monkeypatch.setattr(core, "pair_sims", lambda idx, x, y: pair)

    hits = core.match(index, [_jpeg(), _jpeg()], 3)
    # 0.6 on the composite beats 0.2 on either side alone.
    assert hits[0] == ("pill-1", pytest.approx(core.PAIR_WEIGHT))
    assert dict(hits)["pill-0"] == pytest.approx(core.SIDE_WEIGHT)


def test_open_image_rejects_a_thumbnail_sized_photo():
    with pytest.raises(core.VisionInputError):
        core.open_image(_jpeg(size=(16, 16)))


def test_open_image_rejects_bytes_that_are_not_an_image():
    with pytest.raises(core.VisionInputError):
        core.open_image(b"this is not a jpeg")


def test_attr_probs_is_a_softmax_over_the_head_classes():
    index = _index()
    index.attrs = {
        "shape": (np.eye(3, DIM, dtype=np.float32), np.zeros(3, dtype=np.float32), ["ROUND", "OVAL", "CAPSULE"]),
        "color": (np.eye(2, DIM, dtype=np.float32), np.zeros(2, dtype=np.float32), ["WHITE", "BLUE"]),
    }
    emb = np.zeros(DIM, dtype=np.float32)
    emb[0] = 5.0
    probs = core.attr_probs(index, emb, "shape")
    assert set(probs) == {"ROUND", "OVAL", "CAPSULE"}
    assert sum(probs.values()) == pytest.approx(1.0)
    assert max(probs, key=probs.get) == "ROUND"


def test_attr_probs_is_empty_when_the_heads_are_missing():
    assert core.attr_probs(_index(), np.zeros(DIM, dtype=np.float32), "shape") == {}


def test_providers_can_be_pinned_by_env(monkeypatch):
    """This one variable is the whole move from Mac to a cloud GPU."""
    monkeypatch.setenv("PILL_VISION_PROVIDERS", "CUDAExecutionProvider, CPUExecutionProvider")
    assert core.providers() == ["CUDAExecutionProvider", "CPUExecutionProvider"]


def test_find_pill_candidates_returns_the_requested_number_of_crops():
    index = _index()
    img = core.open_image(_jpeg(size=(400, 300)))
    assert len(core.find_pill_candidates(index, img, keep=2)) == 2
    assert len(core.find_pill_candidates(index, img, keep=1)) == 1
