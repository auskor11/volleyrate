"""Full pipeline for one video: audio + ball detection -> rallies -> review page.

Usage: .venv/bin/python run.py "videos/260926 Game 1.mp4"
"""
import subprocess
import sys
from pathlib import Path

py = sys.executable
for v in sys.argv[1:]:
    v = Path(v)
    for step in (["extract.py", str(v)], ["balltrack.py", str(v)], ["detect.py", v.stem],
                 ["review.py", v.stem]):
        print(f"== {step[0]}", flush=True)
        subprocess.run([py, *step], check=True)
    if (Path("labels") / f"{v.stem}.csv").exists():
        subprocess.run([py, "evaluate.py", v.stem], check=True)
