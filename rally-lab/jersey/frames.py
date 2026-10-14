"""Frames at tagged touches of a reviewed game (ground truth: who touched), for the jersey OCR test."""
import json, random, sys, cv2
snap = json.load(open('../.ratings-check/snapshot.json'))['data']
title, video, n = sys.argv[1], sys.argv[2], int(sys.argv[3])
g = next(g for g in snap['games'] if g['title'] == title)
num = {p['id']: p.get('number') for p in snap['players']}
c = g['court']
team = {p: t for t in 'ab' for p in c[t]['pos'] + c[t]['bench'] if p and p != 'guest'}
touches = [(t['t'], t['p'], t['k']) for r in g['rallies'] if r.get('st') != 'bad' for t in r.get('touches') or [] if num.get(t['p']) is not None]
random.seed(1); touches = sorted(random.sample(touches, min(n, len(touches))))
cap = cv2.VideoCapture(video); out = []
for i, (t, p, k) in enumerate(touches):
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000); ok, f = cap.read()
    if not ok: continue
    a = f'scratch/jersey/f/{i:03d}.jpg'; b = f'scratch/jersey/f/{i:03d}x2.jpg'
    cv2.imwrite(a, f, [cv2.IMWRITE_JPEG_QUALITY, 95])
    cv2.imwrite(b, cv2.resize(f, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC), [cv2.IMWRITE_JPEG_QUALITY, 95])
    out.append({'i': i, 't': t, 'player': p, 'number': num[p], 'team': team.get(p), 'skill': k, 'img': a, 'img2': b})
json.dump({'behind': g.get('behind'), 'frames': out, 'roster': {p: n for p, n in num.items() if n is not None}, 'team': team}, open('scratch/jersey/truth.json', 'w'))
print(len(out), 'frames; camera behind team', g.get('behind'))
