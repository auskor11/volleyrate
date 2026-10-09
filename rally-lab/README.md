# rally-lab

The lab where the rally detector was built and is tuned. It holds:

- **A Python pipeline** that finds rallies in a game video and scores the results against hand-made labels.
- **A browser version** (`web/`) that reproduces the same pipeline pixel for pixel.

The VolleyRate app ships a copy of `web/` in `public/detector/`. After changing anything in `web/`, run this from the repo root:

    npm run sync-detector

## Setup

Requires Python 3.9 or newer. Run from inside `rally-lab/`:

    python3 -m venv .venv
    .venv/bin/pip install -r requirements.txt

Put game videos in `videos/` (git-ignored). Generated files go to `cache/` and `review/` (also git-ignored).

## Scripts

| Script | What it does |
|---|---|
| `run.py "videos/<name>.mp4"` | Full pipeline for one video: audio → ball tracking → rallies → review page |
| `extract.py` | Mono 16 kHz audio → `cache/<name>/audio.npy` |
| `balltrack.py` | Yellow, moving, ball-shaped blobs per frame → `cache/<name>/ball.npz` |
| `detect.py "<name>"` | Ball clusters + contact sounds + clip classifier → `cache/<name>/rallies.json` |
| `review.py "<name>"` | Builds `review/<name>.html` to mark clips ok / bad / added |
| `evaluate.py "<name>"` | Scores detections against `labels/`, only inside the checked time spans |
| `train.py "<name>" ...` | Retrains the clip classifier → `model.json` |
| `serve.py` | Local server with HTTP Range support (so videos can seek) at http://localhost:8765/review/ and /web/ |
| `touches.py` | Prototype for suggesting touch moments from contact sounds |

## How detection works

1. **Ball:** a rally is a cluster of frames with a moving yellow blob above head height. Short gaps are allowed, and the cluster is padded at both ends.
2. **Sanity check:** the ball must travel sideways. Static yellow flicker is rejected.
3. **Audio:** a rally starts with a loud serve contact and/or has many sharp contact sounds. A ball thrown back to the server has neither.
4. **Classifier:** a small logistic regression (`model.json`) drops likely false clips.
5. **Ends:** each clip is split where the ball disappears briefly, which trims off throw-backs after the point.

Frames are converted the same way in both versions, so Python and the browser see identical pixels:

- 4:2:0 YUV → nearest-neighbour chroma upsampling → box downscale to 640 px wide → RGB using the video's own matrix and range.

The browser version decodes with WebCodecs and mp4box.js.

**Accuracy on the reviewed games:**
- About 91–96% of rallies are found.
- About 4–11% of clips are false.

**Speed:** about 27× real time on a Mac and about 10× on an iPhone.

## Labels

| File | Contents |
|---|---|
| `labels/<name>.csv` | Hand-timed rallies (`start, end`). Covers the video from 0 up to the last end. |
| `labels/<name> reviewed.csv` | Exported from the review page. Rows are ok / bad / added. |
| `labels/<name> Description.txt` | Touch sequence per rally. Ground truth for `touches.py`. |

The app can also retrain the classifier in the browser: Admin → Detector. That version starts from `web/train_base.json` and adds clips reviewed in the app.
