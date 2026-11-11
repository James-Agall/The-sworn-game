# Automated sprite audit: runtime PNGs vs. source cells vs. pre-autumn originals.
# usage: python -I audit.py <sprites_dir> <src_root> <orig_dir> <map.json> <out.json>
import json, os, re, sys
from collections import defaultdict
import numpy as np
from PIL import Image
from scipy import ndimage

sprites, src_root, orig_dir, map_path, out_path = sys.argv[1:6]
mapping = json.load(open(map_path))
catalog = {a['name']: a for a in json.load(open(os.path.join(src_root, 'catalog.json'), encoding='utf-8-sig'))}

def alpha(path):
    im = Image.open(path).convert('RGBA')
    return np.asarray(im)

def stats(a):
    al = a[..., 3]
    op = al > 64
    h, w = al.shape
    n = int(op.sum())
    if n == 0:
        return dict(w=w, h=h, n=0, bbox=None, edge={'t': 0, 'b': 0, 'l': 0, 'r': 0})
    ys, xs = np.nonzero(op)
    return dict(w=w, h=h, n=n, bbox=[int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1],
                edge={'t': int(op[0].sum()), 'b': int(op[-1].sum()), 'l': int(op[:, 0].sum()), 'r': int(op[:, -1].sum())})

def src_cell_path(sheet, row, col):
    a = catalog[sheet]
    return os.path.join(src_root, 'frames', sheet, f"{a['rowNames'][row]}-{col + 1:02d}.png")

src_cache = {}
def src_stats(sheet, row, col):
    k = (sheet, row, col)
    if k in src_cache:
        return src_cache[k]
    a = alpha(src_cell_path(sheet, row, col))
    s = stats(a)
    op = a[..., 3] > 64
    lab, nl = ndimage.label(op, structure=np.ones((3, 3)))
    sizes = ndimage.sum(op, lab, range(1, nl + 1)) if nl else []
    main = int(np.argmax(sizes)) + 1 if nl else 0
    # Pieces of neighbouring cells: non-main components touching the border with >= 30 px.
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    intr = sum(int(sizes[i - 1]) for i in border if i != main and sizes[i - 1] >= 30)
    main_touch = 0
    if nl:
        m = lab == main
        main_touch = int(m[0].sum() + m[-1].sum() + m[:, 0].sum() + m[:, -1].sum())
    s['mainTouch'] = main_touch
    s['intrusion'] = intr
    src_cache[k] = s
    return s

rows = []
for root, _, files in os.walk(sprites):
    for f in files:
        if not f.endswith('.png'):
            continue
        p = os.path.join(root, f)
        rel = os.path.relpath(p, sprites).replace(os.sep, '/')
        r = dict(file=rel)
        a = alpha(p)
        r.update(stats(a))
        m = mapping.get(rel)
        if rel.startswith('autumn/frames/'):
            _, _, sheet, nm = rel.split('/')
            rn, cc = nm[:-4].rsplit('-', 1)
            cat = catalog.get(sheet)
            if cat and rn in cat['rowNames']:
                m = dict(sheet=sheet, row=cat['rowNames'].index(rn), column=int(cc) - 1, mode=None)
        if m:
            r['sheet'], r['row'], r['col'], r['mode'] = m['sheet'], m['row'], m['column'], m.get('mode')
            try:
                r['src'] = src_stats(m['sheet'], m['row'], m['column'])
            except Exception as e:
                r['srcErr'] = str(e)
        op = os.path.join(orig_dir, rel)
        if os.path.exists(op):
            r['orig'] = stats(alpha(op))
        rows.append(r)

flags = defaultdict(list)
for r in rows:
    mode = r.get('mode')
    s = r.get('src')
    frame = r['file'].startswith('autumn/frames/')
    tileish = mode in ('tile', 'wall') or (r.get('sheet') or '') in (
        'square-terrain', 'terrain-connections', 'cave-surfaces', 'bridges-water-roofs', 'floors-roofs-terrain', 'crops',
        'walls-doors', 'interior-walls', 'exterior-walls-damaged', 'interior-walls-damaged', 'cave-walls')
    # (a) cut off: runtime touching canvas edge (non-tiles), or the source cell's main body touching the cell edge.
    e = r['edge']
    if not tileish and r['n'] and sum(e.values()) > 2:
        flags['a_canvas_edge'].append(r['file'])
    if s and not tileish and (s['mainTouch'] > 3):
        flags['a_src_cut'].append(r['file'])
    if s and not tileish and s['intrusion'] > 0:
        flags['a_src_intrusion'].append(r['file'])
    # (c) empty / near-empty
    if r['n'] < max(20, 0.01 * r['w'] * r['h']):
        flags['c_empty'].append(r['file'])
    # (b) canvas vs original, (f) aspect change
    o = r.get('orig')
    if o and o['bbox'] and r['bbox']:
        ow, oh = o['bbox'][2] - o['bbox'][0], o['bbox'][3] - o['bbox'][1]
        nw, nh = r['bbox'][2] - r['bbox'][0], r['bbox'][3] - r['bbox'][1]
        oa, na = ow / oh, nw / nh
        r['aspectRatioChange'] = round(na / oa, 2)
        if na / oa > 1.7 or na / oa < 0.59:
            flags['f_aspect_change'].append(r['file'])
        if (o['w'], o['h']) != (r['w'], r['h']):
            ratio = (r['w'] * r['h']) / (o['w'] * o['h'])
            if ratio > 9 or ratio < 0.11:
                flags['b_canvas_vs_orig'].append(r['file'])
            if abs((r['w'] / r['h']) / (o['w'] / o['h']) - 1) > 0.35:
                flags['b_canvas_aspect'].append(r['file'])
    # (e) tile size
    if tileish and mode == 'tile' and (r['w'] % 32 or r['h'] % 32):
        flags['e_tile_size'].append(r['file'])

# (d) animation sets
groups = defaultdict(list)
for r in rows:
    if r['file'].startswith('autumn/'):
        continue
    m = re.fullmatch(r'(.*?)(Walk|Attack|Chop|Mine|Heal|Harvest|Tend|Craft|Build|Carry|Hunt|Forage|Run|Graze|Flap|Idle|Ready|Charge|Death|Roar|Load|Fire|Hit|Destroyed|Fallen|Battered|Pristine)?(\d*)\.png', r['file'])
    if m and (m[2] or m[3]):
        groups[m[1]].append(r)
for base, rs in groups.items():
    rs = [r for r in rs if r['bbox']]
    if len(rs) < 2:
        continue
    sizes = {(r['w'], r['h']) for r in rs}
    bottoms = [r['bbox'][3] for r in rs]
    if len(sizes) > 1:
        flags['d_set_canvas_mismatch'].append(base)
    if max(bottoms) - min(bottoms) > 3:
        flags['d_set_feet_mismatch'].append(base)

# (e) tiling: floors should wrap seamlessly (left vs right col, top vs bottom row)
for r in rows:
    f = r['file']
    if r.get('mode') == 'tile' and re.search(r'(Floor|floor_|ground_|waterTile)', f):
        a = alpha(os.path.join(sprites, f)).astype(int)
        d = (np.abs(a[:, 0, :3] - a[:, -1, :3]).mean() + np.abs(a[0, :, :3] - a[-1, :, :3]).mean()) / 2
        inner = (np.abs(a[:, 31, :3] - a[:, 32, :3]).mean() + np.abs(a[31, :, :3] - a[32, :, :3]).mean()) / 2
        r['seam'] = round(float(d), 1)
        r['seamInner'] = round(float(inner), 1)
        if d > max(30, 2.2 * inner):
            flags['e_tile_seam'].append(f)

json.dump(dict(rows=rows, flags=flags), open(out_path, 'w'), indent=1)
for k, v in sorted(flags.items()):
    rt = [x for x in v if not x.startswith('autumn/')]
    print(f'{k}: {len(v)} (runtime {len(rt)})')
