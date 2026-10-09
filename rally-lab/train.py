"""Train the clip classifier from reviewed videos and write model.json.

Ground truth per video comes from labels/<name>.csv (hand-timed rallies; any clip
inside that time range not overlapping a label is false) and/or
labels/<name> reviewed.csv (exported from the review page: ok / bad / added).

Usage: .venv/bin/python train.py "260926 Game 2-3" [more names...]
"""
import csv
import json
import sys
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import LeaveOneOut, cross_val_predict
from sklearn.preprocessing import StandardScaler

import detect
import evaluate


def ts(s):
    return sum(float(x) * 60 ** i for i, x in enumerate(reversed(s.split(":"))))


def dataset(name):
    p = detect.PARAMS
    labels = evaluate.load_labels(name) if (Path("labels") / f"{name}.csv").exists() else []
    lab_end = labels[-1][1] + 5 if labels else 0
    rp = Path("labels") / f"{name} reviewed.csv"
    rev = [(ts(r["start"]), r["status"]) for r in csv.DictReader(open(rp))] if rp.exists() else []
    tf, flux = detect.onsets(name)
    hb = detect.high_ball(name, p)
    segs = detect.segment(hb, p)
    X, y = [], []
    for i, (a, b, _) in enumerate(segs):
        if a < lab_end:
            st = "ok" if any(evaluate.overlap((a, b), L) > 0 for L in labels) else "bad"
        else:
            st = next((s for s0, s in rev if abs(s0 - a) < 0.3), None)
        if st not in ("ok", "bad"):
            continue
        X.append(detect.features(segs, i, hb, tf, flux))
        y.append(st == "ok")
    return X, y


X, y = [], []
for name in sys.argv[1:]:
    a, b = dataset(name)
    X += a
    y += b
X, y = np.array(X), np.array(y)
print(f"{len(y)} clips: {y.sum()} real, {(~y).sum()} false")

sc = StandardScaler().fit(X)
clf = LogisticRegression(C=1.0)
pr = cross_val_predict(clf, sc.transform(X), y, cv=LeaveOneOut(), method="predict_proba")[:, 1]
keep = pr >= detect.PARAMS["min_prob"]
print(f"leave-one-out: keeps {(keep & y).sum()}/{y.sum()} real, "
      f"{(keep & ~y).sum()}/{(~y).sum()} false -> {(keep & ~y).sum() / keep.sum():.0%} of clips false")

clf.fit(sc.transform(X), y)
json.dump({"mean": sc.mean_.tolist(), "scale": sc.scale_.tolist(),
           "coef": clf.coef_[0].tolist(), "intercept": float(clf.intercept_[0]),
           "trained_on": sys.argv[1:], "n": int(len(y))},
          open(detect.MODEL, "w"), indent=1)
Path("web/model.json").write_text(detect.MODEL.read_text())  # browser detector uses the same model
print(f"wrote {detect.MODEL.name} (+ web/model.json)")
