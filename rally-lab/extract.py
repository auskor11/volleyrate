"""Extract mono audio from a game video for onset (ball-contact sound) analysis.

Usage: .venv/bin/python extract.py "videos/260926 Game 2-3.mp4"
Writes cache/<name>/audio.npy (float32 @ 16 kHz) and meta.json
"""
import json
import subprocess
import sys
import time
from pathlib import Path

import imageio_ffmpeg
import numpy as np

SR = 16000
FF = imageio_ffmpeg.get_ffmpeg_exe()


def extract(video: Path):
    out = Path("cache") / video.stem
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()

    cmd = [FF, "-v", "error", "-i", str(video), "-vn", "-ac", "1", "-ar", str(SR),
           "-f", "f32le", "-"]
    audio = np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, np.float32)
    np.save(out / "audio.npy", audio)
    print(f"audio: {len(audio) / SR:.0f}s in {time.time() - t0:.0f}s")

    json.dump({"video": str(video), "sr": SR, "duration": len(audio) / SR},
              open(out / "meta.json", "w"), indent=2)


if __name__ == "__main__":
    for p in sys.argv[1:]:
        extract(Path(p))
