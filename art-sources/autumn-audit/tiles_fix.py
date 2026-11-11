# terrain-connections (roads, cobble, moat, shore): drop the dark 1-cell frame each source tile has (it drew a grid
# between connected road tiles) and fix mask 3 (N+E), which the sheet drew as N+W (= mask 9): mirror mask 9.
# usage: tiles_fix.py <src_root> <sprites_dir> <map.json>
import json, os, sys
import numpy as np
from PIL import Image
src, sprites, map_path = sys.argv[1:4]
cat = {a['name']: a for a in json.load(open(os.path.join(src, 'catalog.json'), encoding='utf-8-sig'))}['terrain-connections']
mapping = json.load(open(map_path))
INSET = 0.045
def tile(row, col):
    f = next(f for f in cat['frames'] if f['row'] == row and f['column'] == col)
    im = Image.open(os.path.join(src, f['file'])).convert('RGBA')
    a = np.asarray(im)[..., 3]
    ys, xs = np.nonzero(a > 64)
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    dx, dy = round((x1 - x0) * INSET), round((y1 - y0) * INSET)
    t = im.crop((x0 + dx, y0 + dy, x1 - dx, y1 - dy)).resize((64, 64), Image.NEAREST)
    arr = np.asarray(t).copy(); arr[..., 3] = 255
    return Image.fromarray(arr)
out = {}
for row in range(cat['rows']):
    for col in range(cat['cols']):
        mask = (row % 2) * 8 + col
        if mask == 3:
            t = tile(row + 1, 1).transpose(Image.FLIP_LEFT_RIGHT)  # mask 9 (N+W) mirrored = N+E
        else:
            t = tile(row, col)
        out[(row, col)] = t
        t.save(os.path.join(sprites, 'autumn', 'frames', 'terrain-connections', f"{cat['rowNames'][row]}-{col + 1:02d}.png"))
n = 0
for name, m in mapping.items():
    if m['sheet'] == 'terrain-connections':
        out[(m['row'], m['column'])].save(os.path.join(sprites, name)); n += 1
print('runtime', n)
