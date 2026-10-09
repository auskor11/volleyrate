"""Score detected rallies against ground truth, only inside the time spans that were checked.

Ground truth:
  labels/<name>.csv           hand-timed rallies; covers 0 .. last end
  labels/<name> reviewed.csv  exported from the review page; ok/added rows are rallies,
                              bad rows are not; each run of consecutive reviewed rows
                              is a covered span (unreviewed rows are ignored)

Usage: .venv/bin/python evaluate.py "260926 Game 2-3"
"""
import csv
import json
import sys
from pathlib import Path


def ts(s):
    parts = [float(x) for x in s.strip().split(":")]
    return sum(v * 60 ** i for i, v in enumerate(reversed(parts)))


def load_labels(name):
    """Hand-timed rallies only: [(start, end), ...]."""
    lp = Path("labels") / f"{name}.csv"
    if not lp.exists():
        return []
    rows = list(csv.reader(open(lp)))[1:]
    return [(ts(a), ts(b)) for a, b, *_ in rows if a.strip()]


def load_truth(name):
    """All ground truth: (rallies, covered spans)."""
    rallies = load_labels(name)
    spans = [(0.0, rallies[-1][1] + 2)] if rallies else []
    rp = Path("labels") / f"{name} reviewed.csv"
    if rp.exists():
        run = []
        for r in list(csv.DictReader(open(rp))) + [{"status": "unreviewed"}]:
            if r["status"] != "unreviewed":
                run.append((ts(r["start"]), ts(r["end"]), r["status"]))
                continue
            if run:
                # skip rows already covered by hand labels
                hand_end = spans[0][1] if spans and rallies else 0
                run = [x for x in run if x[0] >= hand_end]
            if run:
                spans.append((run[0][0] - 2, run[-1][1] + 2))
                rallies += [(s, e) for s, e, st in run if st in ("ok", "added")]
            run = []
    return sorted(set(rallies)), spans


def overlap(a, b):
    return max(0.0, min(a[1], b[1]) - max(a[0], b[0]))


def score(truth, rallies, verbose=False):
    labels, spans = truth
    inside = lambda r: any(overlap(r, s) > 0 for s in spans)
    labels = [L for L in labels if inside(L)]
    det = [r for r in rallies if inside(r)]
    used = set()
    matches, missed = [], []
    for L in labels:
        best = max(range(len(det)), key=lambda j: overlap(L, det[j]), default=None)
        if best is not None and overlap(L, det[best]) > 0 and best not in used:
            used.add(best)
            matches.append((L, det[best]))
        else:
            missed.append(L)
    false = [d for j, d in enumerate(det) if j not in used]
    s_err = [d[0] - L[0] for L, d in matches]
    e_err = [d[1] - L[1] for L, d in matches]
    res = dict(labels=len(labels), detected=len(det), matched=len(matches),
               recall=len(matches) / max(1, len(labels)), false=len(false),
               start_err=sum(map(abs, s_err)) / max(1, len(s_err)),
               end_err=sum(map(abs, e_err)) / max(1, len(e_err)),
               late=sum(e > 2 for e in e_err), early=sum(e < -1 for e in e_err))
    if verbose:
        f = lambda t: f"{int(t // 60)}:{t % 60:04.1f}"
        print(f"Checked spans:           " + ", ".join(f"{f(a)}-{f(b)}" for a, b in spans))
        print(f"Real rallies:            {res['labels']}")
        print(f"Clips detected:          {res['detected']}")
        print(f"  matched:               {res['matched']}  ({res['recall']:.0%} found)")
        print(f"  missed:                {len(missed)}")
        print(f"  false clips:           {len(false)}  ({len(false) / max(1, len(det)):.0%} of clips)")
        print(f"Avg start error:         {res['start_err']:.1f}s")
        print(f"Avg end error:           {res['end_err']:.1f}s  "
              f"(>2s late: {res['late']}, >1s early: {res['early']})")
        print()
        for (L, d), se, ee in zip(matches, s_err, e_err):
            flag = "  ← late" if ee > 2 else "  ← cut short" if ee < -1 else ""
            print(f"  ✓ {f(L[0])}-{f(L[1])}  →  {f(d[0])}-{f(d[1])}   start {se:+.1f}s end {ee:+.1f}s{flag}")
        for L in missed:
            print(f"  ✗ MISSED {f(L[0])}-{f(L[1])}")
        for d in false:
            print(f"  ✗ FALSE  {f(d[0])}-{f(d[1])}")
    return res


if __name__ == "__main__":
    name = sys.argv[1]
    rallies = json.load(open(Path("cache") / name / "rallies.json"))["rallies"]
    score(load_truth(name), rallies, verbose=True)
