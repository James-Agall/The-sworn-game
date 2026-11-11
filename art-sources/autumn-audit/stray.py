# Residual check: separate opaque blobs (>=12 px) lying more than 6 px from the main sprite in actor/prop frames.
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage
R, mp = sys.argv[1:3]
m = json.load(open(mp))
bad = []
for n, x in m.items():
    if x['mode'] not in ('actor', 'prop', 'furniture') or not os.path.exists(os.path.join(R, n)): continue
    a = np.asarray(Image.open(os.path.join(R, n)).convert('RGBA'))[..., 3] > 64
    lab, k = ndimage.label(ndimage.binary_dilation(a, np.ones((13, 13), bool)))
    if k < 2: continue
    sz = ndimage.sum(a, lab, range(1, k + 1))
    if sorted(sz)[-2] >= 12: bad.append(n)
print(len(bad)); print(bad[:60])
