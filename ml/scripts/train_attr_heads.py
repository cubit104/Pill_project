"""Train shape & color classifiers on top of the CLIP fingerprints.

Uses index_prod.npz (fingerprints + slug) and manifest.json (slug -> shape,
color). Saves pill_attr_heads.npz with linear weights the backend can apply
to a query crop's embedding in microseconds.
"""
import json, re
import numpy as np
from sklearn.linear_model import LogisticRegression

idx = np.load("index_prod.npz"); V = idx["vectors"]; meta = json.loads(str(idx["meta"]))
man = json.load(open("manifest.json", encoding="utf-8-sig"))
attrs = {}
for r in man:
    attrs.setdefault(r["slug"], (r["shape"].upper().strip(), r["color"].upper().strip()))

def primary(s):  # "BLUE, WHITE" -> "BLUE"; "CAPSULE" stays
    return re.split(r"[;,/]", s)[0].strip()

X, ys, yc = [], [], []
for v, m in zip(V, meta):
    a = attrs.get(m["slug"])
    if not a: continue
    sh, co = primary(a[0]), primary(a[1])
    if not sh or not co: continue
    X.append(v); ys.append(sh); yc.append(co)
X = np.array(X); ys = np.array(ys); yc = np.array(yc)
print(f"{len(X)} labeled fingerprints; shapes={len(set(ys))}, colors={len(set(yc))}")

rng = np.random.RandomState(0); perm = rng.permutation(len(X)); cut = int(len(X)*0.9)
tr, te = perm[:cut], perm[cut:]
out = {}
for name, y in (("shape", ys), ("color", yc)):
    clf = LogisticRegression(max_iter=2000, C=2.0)
    clf.fit(X[tr], y[tr])
    acc = clf.score(X[te], y[te])
    print(f"{name}: held-out accuracy {100*acc:.1f}%  classes={list(clf.classes_)[:12]}{'...' if len(clf.classes_)>12 else ''}")
    out[f"{name}_W"] = clf.coef_.astype(np.float32)
    out[f"{name}_b"] = clf.intercept_.astype(np.float32)
    out[f"{name}_classes"] = np.array(clf.classes_)
np.savez_compressed("pill_attr_heads.npz", **out)
print("saved pill_attr_heads.npz")
