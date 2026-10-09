"""Turn ball candidates into rally segments.

1. Ball: a rally = a cluster of frames where a moving yellow blob is above
   head height, with gaps no longer than GAP seconds. Padded at both ends.
2. Sanity: the ball must travel sideways (static yellow flicker is rejected).
3. Audio: a rally starts with a loud serve contact and/or has many sharp
   ball-contact sounds. Balls thrown back to the server between points have
   neither, which is where most false clips came from.
4. Classifier: a small logistic regression (model.json, trained by train.py on
   reviewed clips) scores the surviving clips and drops likely false ones.
5. Ends: after a rally the ball is often thrown back over the net, which keeps
   the clip running. Each clip is split where the ball disappears for a moment;
   a following flight with no loud contact sounds is a throw-back and ends the
   rally. If a loud serve comes after it, that starts a new rally.

Usage: .venv/bin/python detect.py "260926 Game 2-3"   -> cache/<name>/rallies.json
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy.signal import stft

PARAMS = dict(
    y_max=110,       # px at 640x360: "above head height" line
    min_hue=18,      # OpenCV hue: ball yellow is ~20-35
    gap=4.0,         # s: max gap between high-ball sightings inside one rally
    min_hits=3,      # min high-ball frames for a cluster to count as a rally
    min_len=0.3,     # s: min span of sightings
    pad_start=1.0,   # s before first sighting (catch the serve toss)
    pad_end=1.0,     # s after last sighting (ball falling to the floor)
    min_xrange=40,   # px: ball must travel at least this far sideways
    serve_peak=9.0,  # loudest onset in [-1.5s, +0.2s] around first sighting, x median
    hit_rate=1.5,    # strong onsets (> 6x median) per second during the clip
    min_prob=0.4,    # classifier probability needed to keep a clip
    split_gap=1.6,   # s: pause in high-ball sightings that may separate rally / throw-back
    loud=12.0,       # onset strength (x median) that counts as a ball contact
    min_loud=2,      # contacts a flight needs to count as part of the rally
    end_pad=1.5,     # s after the last rally flight (replaces pad_end in the output)
)
MODEL = Path(__file__).parent / "model.json"


def load(name):
    d = np.load(Path("cache") / name / "ball.npz")
    return d["cand"], int(d["nframes"]), float(d["fps"])


def high_ball(name, p=PARAMS):
    """Rows (t, x) of ball sightings above head height."""
    cand, n, fps = load(name)
    m = (cand[:, 2] < p["y_max"]) & (cand[:, 5] >= p["min_hue"])
    return np.c_[(cand[m, 0] * fps).round() / fps, cand[m, 1]]


def onsets(name):
    """Onset strength (positive log-spectral flux) over time, normalised by its median."""
    sr = json.load(open(Path("cache") / name / "meta.json"))["sr"]
    audio = np.load(Path("cache") / name / "audio.npy")
    _, tt, Z = stft(audio, fs=sr, nperseg=256, noverlap=128)
    flux = np.maximum(np.diff(np.log1p(np.abs(Z) * 200), axis=1), 0).sum(0)
    return tt[1:], flux / np.median(flux)


def segment(hb, p):
    if len(hb) == 0:
        return []
    hb = hb[np.argsort(hb[:, 0])]
    rallies = []
    for g in np.split(hb, np.flatnonzero(np.diff(hb[:, 0]) > p["gap"]) + 1):
        t = np.unique(g[:, 0])
        if (len(t) >= p["min_hits"] and t[-1] - t[0] >= p["min_len"]
                and np.ptp(g[:, 1]) >= p["min_xrange"]):
            rallies.append([max(0.0, t[0] - p["pad_start"]), t[-1] + p["pad_end"], t[0]])
    return rallies


def audio_feats(r, tf, flux):
    a, b, first = r
    w = (tf >= first - 1.5) & (tf <= first + 0.2)
    peak = flux[w].max() if w.any() else 0
    rate = (flux[(tf >= a) & (tf <= b)] > 6).sum() / (b - a)
    return peak, rate


def audio_ok(r, tf, flux, p):
    peak, rate = audio_feats(r, tf, flux)
    return peak >= p["serve_peak"] or rate >= p["hit_rate"]


def features(segs, i, hb, tf, flux):
    """Classifier features for clip i: serve loudness, contact-sound rate, length,
    ball sightings per second, sideways travel, gap since the previous clip."""
    a, b, first = segs[i]
    peak, rate = audio_feats(segs[i], tf, flux)
    g = hb[(hb[:, 0] >= a) & (hb[:, 0] <= b)]
    hits = len(np.unique(g[:, 0]))
    gap_prev = a - segs[i - 1][1] if i else 60.0
    return [np.log(peak + 1), rate, np.log(b - a), hits / (b - a),
            np.ptp(g[:, 1]) / 100, min(gap_prev, 60.0) / 10]


def prob(x, m):
    z = (np.array(x) - m["mean"]) / m["scale"]
    return 1 / (1 + np.exp(-(z @ np.array(m["coef"]) + m["intercept"])))


def split_quiet(r, hb, tf, flux, p):
    """Cut a clip at quiet flights (throw-backs); start a new clip at a later loud serve."""
    a, b, first = r
    t = np.unique(hb[(hb[:, 0] >= first) & (hb[:, 0] <= b - p["pad_end"] + 1e-3), 0])
    pieces = np.split(t, np.flatnonzero(np.diff(t) > p["split_gap"]) + 1)
    loud = lambda lo, hi: (flux[(tf >= lo) & (tf <= hi)] > p["loud"]).sum()
    clips, cur = [], [pieces[0]]
    for pc in pieces[1:]:
        if cur and loud(pc[0] - 0.5, pc[-1] + 0.3) >= p["min_loud"]:
            cur.append(pc)
        elif cur:
            clips.append(cur)  # quiet flight: rally is over
            cur = []
        elif loud(pc[0] - 1.5, pc[0] + 0.2) >= 1 and \
                flux[(tf >= pc[0] - 1.5) & (tf <= pc[0] + 0.2)].max() >= p["serve_peak"]:
            cur = [pc]  # loud serve after a throw-back: a new rally
    if cur:
        clips.append(cur)
    out = [[a if i == 0 else max(0.0, c[0][0] - p["pad_start"]), c[-1][-1] + p["end_pad"]]
           for i, c in enumerate(clips)
           if i == 0 or sum(len(x) for x in c) >= p["min_hits"]]
    return out


def detect(name, p=PARAMS):
    tf, flux = onsets(name)
    hb = high_ball(name, p)
    segs = segment(hb, p)
    model = json.load(open(MODEL)) if MODEL.exists() else None
    out = []
    for i, r in enumerate(segs):
        if not audio_ok(r, tf, flux, p):
            continue
        if model and prob(features(segs, i, hb, tf, flux), model) < p["min_prob"]:
            continue
        out += split_quiet(r, hb, tf, flux, p)
    return out


if __name__ == "__main__":
    name = sys.argv[1]
    r = detect(name)
    json.dump({"params": PARAMS, "rallies": [[round(float(a), 1), round(float(b), 1)] for a, b in r]},
              open(Path("cache") / name / "rallies.json", "w"), indent=1)
    print(f"{len(r)} rallies -> cache/{name}/rallies.json")
