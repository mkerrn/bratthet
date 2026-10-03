"""Picture of model against NVE for one area and one alpha class.

Usage: .venv/bin/python view.py <area> [--tag baseline] [--class long|medium|short]
Writes cache/<area>/view-<tag>-<class>.png:
  grey   NVE >27 degrees (left out of the scores)
  blue   both say runout
  red    model only (over-warns)
  orange NVE only (model misses it)
  black  our start cells that NVE puts below 27 degrees
"""
import os, sys
import numpy as np
from PIL import Image
import score

args, tag, cls = sys.argv[1:], 'baseline', 'long'
area = args.pop(0)
while args:
    k = args.pop(0)
    if k == '--tag': tag = args.pop(0)
    elif k == '--class': cls = args.pop(0)
k = {'short': 1, 'medium': 2, 'long': 3}[cls]
meta, mod, steep, band, _ = score.load(area, tag)
ig = steep > 0
n = (band > 0) & (band <= k) & ~ig
m = ((mod & 3) > 0) & ((mod & 3) <= k) & ~ig
img = np.full(n.shape + (3,), 255, np.uint8)
img[ig] = (200, 200, 200)
img[n & m] = (40, 90, 200)
img[m & ~n] = (220, 40, 40)
img[n & ~m] = (250, 160, 0)
img[((mod & 4) > 0) & ~ig] = (0, 0, 0)
out = os.path.join(score.CACHE, area, f'view-{tag}-{cls}.png')
Image.fromarray(img).save(out)
print(out)
