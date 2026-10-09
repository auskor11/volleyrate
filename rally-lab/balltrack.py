"""Find yellow, moving, ball-shaped blobs in each frame.

Usage: .venv/bin/python balltrack.py "videos/260926 Game 2-3.mp4" [max_seconds]
Writes cache/<name>/ball.npz with candidate rows (t, x, y, area, moving, h, s, v, fill).

Frames go through a fixed "canonical" pipeline that web/analyze.js reproduces exactly,
so the browser and Python see the same pixels:
  raw YUV 4:2:0 (8 or 10 bit) -> chroma nearest-upsampled to full size
  -> box-average down by f = width / 640 -> RGB with the video's own matrix/range
  -> 8-bit BGR, rounded.
"""
import re
import subprocess
import sys
import time
from pathlib import Path

import cv2
import imageio_ffmpeg
import numpy as np

FPS = 15
OUT_W = 640
FF = imageio_ffmpeg.get_ffmpeg_exe()

# yellow panels of the ball (OpenCV hue 0-180)
LO = np.array([18, 60, 100], np.uint8)
HI = np.array([40, 255, 255], np.uint8)
MIN_AREA, MAX_AREA = 6, 900  # ball grows a lot when it flies toward the camera

MATRICES = {"bt601": (0.299, 0.114), "bt709": (0.2126, 0.0722), "bt2020": (0.2627, 0.0593)}


def probe(video):
    """Width, height, bit depth, full range?, matrix name from ffmpeg's stream line."""
    info = subprocess.run([FF, "-hide_banner", "-i", str(video)], capture_output=True, text=True).stderr
    line = next(l for l in info.splitlines() if "Video:" in l)
    w, h = map(int, re.search(r", (\d{3,5})x(\d{3,5})", line).groups())
    pix = re.search(r"Video: \w+.*?, (\w+)\(", line) or re.search(r"Video: \w+.*?, (\w+),", line)
    pix = pix.group(1)
    bits = 10 if "10" in pix else 8
    full = "pc" in line.split(pix, 1)[1][:20] or pix.startswith("yuvj")
    matrix = "bt2020" if "bt2020" in line else "bt709" if "bt709" in line else "bt601"
    return w, h, bits, full, matrix


def to_bgr(Y, U, V, f, bits, full, matrix):
    """Canonical conversion; must match yuvToRgbSmall() in web/analyze.js."""
    h, w = Y.shape
    U = U.repeat(2, 0).repeat(2, 1)[:h, :w]
    V = V.repeat(2, 0).repeat(2, 1)[:h, :w]
    oh, ow = h // f, w // f
    box = lambda P: P[:oh * f, :ow * f].reshape(oh, f, ow, f).mean((1, 3))
    y, u, v = box(Y), box(U), box(V)
    s = 1 << (bits - 8)
    if full:
        y = y / (255 * s)
    else:
        y = (y / s - 16) / 219
    u = (u / s - 128) / (255 if full else 224)
    v = (v / s - 128) / (255 if full else 224)
    kr, kb = MATRICES[matrix]
    kg = 1 - kr - kb
    r = y + 2 * (1 - kr) * v
    b = y + 2 * (1 - kb) * u
    g = (y - kr * r - kb * b) / kg
    return np.clip(np.floor(np.stack([b, g, r], -1) * 255 + 0.5), 0, 255).astype(np.uint8)


def find_candidates(img, prev_gray, t, kernel=np.ones((3, 3), np.uint8)):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    if prev_gray is None:
        prev_gray = gray
    moving = cv2.absdiff(gray, prev_gray) > 18
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    # only keep yellow pixels that changed: kills static shirts, bags, leaves
    mask = cv2.inRange(hsv, LO, HI)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    rows = []
    n, lab, stats, cent = cv2.connectedComponentsWithStats(mask)
    for k in range(1, n):
        x, y, w, h, a = stats[k]
        if not (MIN_AREA <= a <= MAX_AREA) or max(w, h) > 2 * min(w, h) + 2:
            continue
        px = lab[y:y + h, x:x + w] == k
        mv = float(moving[y:y + h, x:x + w][px].mean())
        if mv < 0.3:
            continue
        h_, s_, v_ = hsv[y:y + h, x:x + w][px].mean(0)
        rows.append((t, cent[k][0], cent[k][1], a, mv, h_, s_, v_, a / (w * h)))
    return rows, gray


def run(video: Path, max_s=None):
    out = Path("cache") / video.stem
    out.mkdir(parents=True, exist_ok=True)
    w, h, bits, full, matrix = probe(video)
    f = max(1, round(w / OUT_W))
    pix = "yuv420p10le" if bits == 10 else "yuv420p"
    cmd = [FF, "-v", "error", "-hwaccel", "videotoolbox"]
    if max_s:
        cmd += ["-t", str(max_s)]
    cmd += ["-i", str(video), "-vf", f"fps={FPS}", "-pix_fmt", pix, "-f", "rawvideo", "-"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    dt = np.uint16 if bits == 10 else np.uint8
    bpp = 2 if bits == 10 else 1
    ysz, csz = w * h, (w // 2) * (h // 2)
    fsize = (ysz + 2 * csz) * bpp
    print(f"{w}x{h} {bits}-bit {'full' if full else 'limited'} {matrix}, f={f}")
    prev_gray = None
    rows = []
    i = 0
    t0 = time.time()
    while True:
        buf = proc.stdout.read(fsize)
        if len(buf) < fsize:
            break
        d = np.frombuffer(buf, dt).astype(np.float32)
        Y = d[:ysz].reshape(h, w)
        U = d[ysz:ysz + csz].reshape(h // 2, w // 2)
        V = d[ysz + csz:].reshape(h // 2, w // 2)
        img = to_bgr(Y, U, V, f, bits, full, matrix)
        r, prev_gray = find_candidates(img, prev_gray, i / FPS)
        rows += r
        i += 1
        if i % (FPS * 300) == 0:
            print(f"  {i / FPS:.0f}s processed ({time.time() - t0:.0f}s)", flush=True)
    np.savez(out / "ball.npz", cand=np.array(rows, np.float32).reshape(-1, 9),
             nframes=i, fps=FPS, w=w // f, h=h // f)
    print(f"{i} frames, {len(rows)} candidates in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    run(Path(sys.argv[1]), float(sys.argv[2]) if len(sys.argv) > 2 else None)
