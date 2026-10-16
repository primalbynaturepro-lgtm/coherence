"""Turns tests/fixtures/finger-*.json (mean red and green of each frame) into an .mjpeg file that Chromium can
play as a fake camera (--use-file-for-fake-video-capture): a red field, lit unevenly, whose brightness beats like a pulse.
usage: python3 make-fake-camera.py finger-64.json out.mjpeg [--dark] [--nofinger]
  --dark      the flash never lit: a dim red field (finger in the dark) with the same pulse, 40 times weaker
  --nofinger  a grey room, nothing beating"""
import io, json, sys
import numpy as np
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
dark = '--dark' in sys.argv
nofinger = '--nofinger' in sys.argv
d = json.load(open(src))
r, g = np.array(d['r']), np.array(d['g'])
W, H = 160, 120
rng = np.random.default_rng(7)
yy, xx = np.mgrid[0:H, 0:W]
vign = 1.0 - 0.22 * (((xx - W * 0.35) / W) ** 2 + ((yy - H * 0.3) / H) ** 2) * 4         # the flash sits near a corner
buf = io.BytesIO()
for i in range(len(r)):
    if nofinger:
        base = np.stack([np.full((H, W), 118.0), np.full((H, W), 112.0), np.full((H, W), 104.0)], -1)
        base += 4 * np.sin(i / 40.0)
    elif dark:
        # dim finger, no flash: an ambient red field around 45, the pulse a fraction of what it is with the flash
        rv = 45 + (r[i] - np.mean(r)) * 0.05
        gv = 9 + (g[i] - np.mean(g)) * 0.05
        base = np.stack([np.full((H, W), rv), np.full((H, W), gv), np.full((H, W), 5.0)], -1)
    else:
        base = np.stack([np.full((H, W), r[i]), np.full((H, W), g[i]), np.full((H, W), 12.0)], -1)
    frame = base * vign[..., None] + rng.normal(0, 2.2, (H, W, 3))
    img = Image.fromarray(np.clip(frame, 0, 255).astype(np.uint8), 'RGB')
    img.save(buf, format='JPEG', quality=92, subsampling=0)
open(out, 'wb').write(buf.getvalue())
print(out, len(buf.getvalue()) // 1024, 'KB', len(r), 'frames')
