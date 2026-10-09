"""Build a local review page for detected rallies.

Usage: .venv/bin/python review.py "260926 Game 2-3"   -> review/<name>.html (open in Safari/Chrome)
"""
import csv
import json
import sys
from pathlib import Path

import evaluate

name = sys.argv[1]
det = json.load(open(Path("cache") / name / "rallies.json"))["rallies"]
lab_path = Path("labels") / f"{name}.csv"
labels = evaluate.load_labels(name) if lab_path.exists() else []
video = next(Path("videos").glob(f"{name}.*"))

out = Path("review") / f"{name}.html"
out.parent.mkdir(exist_ok=True)
html = (Path(__file__).parent / "review_template.html").read_text()
html = (html.replace("__NAME__", name)
            .replace("__VIDEO__", "../videos/" + video.name)
            .replace("__RALLIES__", json.dumps(det))
            .replace("__LABELS__", json.dumps(labels)))
out.write_text(html)
print(f"open \"{out.resolve()}\"")
