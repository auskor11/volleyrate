"""Can a camera tell which team served? Tests serve signals against a reviewed game's confirmed servers.

Labels come from a Firestore dump (the app's games): each rally's confirmed serve (first touch) and the
game's court setup (which team each player is on; 'guest-a' / 'guest-b' say their team).
Ball candidates and audio come from cache/<video stem> (extract.py + balltrack.py).

Usage: .venv/bin/python serve_side.py <dump.json> "<game title>" <video stem>
"""
import json
import sys

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import LeaveOneOut, cross_val_predict
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

import detect


def serve_features(cand, tf, flux, t0):
    """Ball and sound around a serve contact at t0 (video seconds)."""
    near = cand[(cand[:, 0] >= t0 - 1.0) & (cand[:, 0] <= t0 + 0.3)]
    post = cand[(cand[:, 0] >= t0 - 0.1) & (cand[:, 0] <= t0 + 1.0)]
    post = post[np.argsort(post[:, 0])]
    w = (tf >= t0 - 0.4) & (tf <= t0 + 0.4)
    return {
        "size": np.log(np.median(near[:, 3]) + 1) if len(near) else np.nan,
        "height": np.median(near[:, 2]) if len(near) else np.nan,
        "x": np.median(near[:, 1]) if len(near) else np.nan,
        "grows": np.polyfit(post[:, 0], np.log(post[:, 3] + 1), 1)[0] if len(post) >= 3 else np.nan,
        "loud": np.log(flux[w].max() + 1) if w.any() else np.nan,
    }


def main(dump, title, stem):
    d = json.load(open(dump))
    g = next(g for g in d["games"] if g["title"] == title)
    c = g["court"]
    team = {p: t for t in "ab" for p in c[t]["pos"] + c[t]["bench"] if p and p != "guest"}
    team.update({"guest-a": "a", "guest-b": "b"})
    cand, _, _ = detect.load(stem)
    cand = cand[cand[:, 5] >= 18]
    tf, flux = detect.onsets(stem)
    rows = []
    for r in sorted(g["rallies"], key=lambda r: r["s"]):
        ts = r.get("touches") or []
        if r["st"] == "bad" or not ts or ts[0]["k"] != "serve" or ts[0]["p"] not in team:
            continue
        rows.append((team[ts[0]["p"]], serve_features(cand, tf, flux, ts[0]["t"])))
    near = g.get("behind")  # the team the camera stands behind serves from the near end
    y = np.array([t == near for t, _ in rows])
    print(f"{len(rows)} confirmed serves: {y.sum()} by Team {near.upper()} (near end), {len(y) - y.sum()} by the far team")
    keys = list(rows[0][1])
    X = np.array([[f[k] for k in keys] for _, f in rows], float)
    for j, k in enumerate(keys):
        v = X[:, j]
        ok = ~np.isnan(v)
        best = max(np.mean((s * (v[ok] - th) > 0) == y[ok]) for th in v[ok] for s in (1, -1))
        print(f"  {k:7} near {np.nanmedian(v[y]):7.2f}   far {np.nanmedian(v[~y]):7.2f}   best single cut {best:.0%} (n={ok.sum()})")
    X = np.where(np.isnan(X), np.nanmedian(X, axis=0), X)
    pred = cross_val_predict(make_pipeline(StandardScaler(), LogisticRegression(C=0.5)), X, y, cv=LeaveOneOut())
    print(f"all signals combined (fair test): {np.mean(pred == y):.0%} right; always-guess baseline {max(y.mean(), 1 - y.mean()):.0%}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
