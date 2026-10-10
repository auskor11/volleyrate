"""Tune the detector's rules for one camera against a reviewed game.

Ground truth: labels/<name> truth.json  ({"truth": [[s, e], ...]} = rallies kept or added in review).
Ball candidates and audio come from cache/<name> (run extract.py and balltrack.py first).

Usage: .venv/bin/python tune_camera.py "Back Angle" [key=value ...]   e.g. y_max=200 min_xrange=10
Prints rallies found / missed / false clips, and why each missed rally was missed.
"""
import json
import sys
from pathlib import Path

import numpy as np

import detect


def evaluate(name, p, model=None, verbose=True):
    truth = json.load(open(Path("labels") / f"{name} truth.json"))["truth"]
    tf, flux = detect.onsets(name)
    hb = detect.high_ball(name, p)
    segs = detect.segment(hb, p)
    out = []
    for i, r in enumerate(segs):
        if not detect.audio_ok(r, tf, flux, p):
            continue
        if model and detect.prob(detect.features(segs, i, hb, tf, flux), model) < p["min_prob"]:
            continue
        out += detect.split_quiet(r, hb, tf, flux, p)
    # each clip counts for one rally at most (the one it overlaps most), like in review: a clip that
    # swallows several rallies only finds one of them
    ov = lambda a, b, s, e: min(b, e) - max(a, s)
    found = [False] * len(truth)
    false = []
    for c in out:
        best = max(range(len(truth)), key=lambda k: ov(c[0], c[1], *truth[k]), default=None)
        if best is None or ov(c[0], c[1], *truth[best]) <= 0:
            false.append(c)
        else:
            found[best] = True
    if verbose:
        print(f"found {sum(found)}/{len(truth)} rallies ({100 * sum(found) / len(truth):.0f}%), "
              f"{len(false)} false clips of {len(out)} ({100 * len(false) / max(1, len(out)):.0f}%)")
    return found, false, out, truth


def why_missed(name, p):
    found, _, _, truth = evaluate(name, p, verbose=False)
    cand, _, fps = detect.load(name)
    tf, flux = detect.onsets(name)
    reasons = {}
    for (s, e), ok in zip(truth, found):
        if ok:
            continue
        w = cand[(cand[:, 0] >= s) & (cand[:, 0] <= e)]
        yellow = w[w[:, 5] >= p["min_hue"]]
        high = yellow[yellow[:, 2] < p["y_max"]]
        if not len(yellow):
            why = "no ball seen at all"
        elif not len(high):
            why = f"ball seen but never above the line (highest y={yellow[:, 2].min():.0f})"
        elif len(np.unique(high[:, 0])) < p["min_hits"]:
            why = f"ball above the line only {len(np.unique(high[:, 0]))} frames"
        elif np.ptp(high[:, 1]) < p["min_xrange"]:
            why = f"too little sideways travel ({np.ptp(high[:, 1]):.0f}px)"
        else:
            r = [s, e, high[0, 0]]
            peak, rate = detect.audio_feats(r, tf, flux)
            why = f"too quiet (serve peak {peak:.1f}, hit rate {rate:.2f})" if not detect.audio_ok(r, tf, flux, p) \
                else "split / other"
        reasons.setdefault(why.split(" (")[0], []).append((round(s, 1), why))
    for k, v in sorted(reasons.items(), key=lambda kv: -len(kv[1])):
        print(f"  {len(v):3d}  {k}: e.g. {', '.join(f'{t}s' for t, _ in v[:4])}")
        for t, w in v[:3]:
            print(f"         {t}s: {w}")


if __name__ == "__main__":
    name = sys.argv[1]
    p = dict(detect.PARAMS)
    for kv in sys.argv[2:]:
        k, v = kv.split("=")
        p[k] = float(v)
    evaluate(name, p)
    why_missed(name, p)
