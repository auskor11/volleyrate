"""Prototype: suggest touch moments inside rallies from ball-contact sounds (+ ball track).

Ground truth for now: touch counts per rally from labels/<name> Description.txt.
"""
import csv
import sys
from pathlib import Path

import numpy as np
from scipy.signal import find_peaks

import detect
import evaluate

DESC_TOUCHES = [1, 1, 1, 8, 4, 7, 3, 4, 1, 1, 4, 4, 3, 1, 13, 1, 1, 4, 3]  # rallies 1-19, Game 2-3


def peaks(tf, flux, a, b, height, dist):
    w = (tf >= a) & (tf <= b)
    idx, props = find_peaks(flux[w], height=height, distance=max(1, int(dist / (tf[1] - tf[0]))))
    return tf[w][idx], props["peak_heights"]


if __name__ == "__main__":
    name = "260926 Game 2-3"
    tf, flux = detect.onsets(name)
    labels = evaluate.load_labels(name)[:len(DESC_TOUCHES)]
    print("rally  true  | detected counts for (height, min-gap)")
    grid = [(h, d) for h in (6, 10, 15, 25) for d in (0.3, 0.5, 0.7)]
    errs = {g: [] for g in grid}
    for (a, b), n in zip(labels, DESC_TOUCHES):
        row = []
        for g in grid:
            t, _ = peaks(tf, flux, a - 0.5, b + 0.5, *g)
            errs[g].append(len(t) - n)
            row.append(len(t))
        print(f"{evaluate_fmt(a) if False else f'{int(a//60)}:{a%60:04.1f}':>7} {n:4d}  | " + " ".join(f"{c:3d}" for c in row))
    print("\nheight gap  mean|err|  total(det/true)")
    for g in grid:
        e = np.array(errs[g]); print(f"{g[0]:6} {g[1]:4}  {np.abs(e).mean():6.2f}   {e.sum() + sum(DESC_TOUCHES)}/{sum(DESC_TOUCHES)}")
