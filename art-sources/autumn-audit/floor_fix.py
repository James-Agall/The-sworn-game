# Seamless ground: water / moat ripple / roof tiles lose the dark frame each source cell had (a grid on every roof and
# pond); square-terrain floors become fully opaque; grassFloor2 is colour-matched to grassFloor1 (was a checkerboard).
import json, os, re, sys
import numpy as np
from PIL import Image
R, map_path = sys.argv[1:3]
m = json.load(open(map_path))
def deframe(p, inset=3):
    im = Image.open(p).convert('RGBA')
    w, h = im.size
    t = im.crop((inset, inset, w - inset, h - inset)).resize((w, h), Image.NEAREST)
    a = np.asarray(t).copy(); a[..., 3] = 255
    Image.fromarray(a).save(p)
n = 0
for name, x in m.items():
    if re.fullmatch(r'(waterTile\d?|moatRipple\d|structure/roof_(thatch|tile|slate))\.png', name):
        deframe(os.path.join(R, name)); n += 1
for row, names in [('bridges-water-roofs', None)]:
    d = os.path.join(R, 'autumn/frames/bridges-water-roofs')
    for f in os.listdir(d):
        if re.match(r'(water-animation|clay-roofs|shingle-roofs|slate-roofs|thatch-roofs)-', f):
            deframe(os.path.join(d, f)); n += 1
for name, x in m.items():
    if x['sheet'] == 'square-terrain':
        p = os.path.join(R, name); a = np.asarray(Image.open(p).convert('RGBA')).copy(); a[..., 3] = 255; Image.fromarray(a).save(p); n += 1
g1 = np.asarray(Image.open(os.path.join(R, 'grassFloor1.png')).convert('RGBA')).astype(float)
p2 = os.path.join(R, 'grassFloor2.png')
g2 = np.asarray(Image.open(p2).convert('RGBA')).astype(float)
g2[..., :3] = np.clip(g2[..., :3] * (g1[..., :3].reshape(-1, 3).mean(0) / g2[..., :3].reshape(-1, 3).mean(0)), 0, 255)
Image.fromarray(g2.astype(np.uint8)).save(p2)
print('fixed', n)
