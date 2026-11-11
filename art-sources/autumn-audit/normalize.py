# Python port of reproduction/normalize-autumn.ps1, fed by the component re-extraction (reextract.py).
# Regenerates only non-grid sheets (actors, props, icons, effects, furniture); tiles and walls are untouched.
# usage: python -I normalize.py <reex_root> <map.json> <out_sprites_dir>
# Changes vs. the PowerShell export:
#  * cells come from connected components (no neighbour pieces, no grid cuts);
#  * actor frames are centred on their own opaque-mass centroid (stable feet, no grid drift) on a canvas wide
#    enough for the row/sheet, feet on y=126 of a 128 px canvas;
#  * sheets that show ONE person across several rows (tiers, tool/task directions) share one scale per sheet, so a
#    body does not change size when the game switches rows (walk -> tool, T1 -> T3).
import json, os, sys
import numpy as np
from PIL import Image

reex, map_path, out = sys.argv[1:4]
catalog = {a['name']: a for a in json.load(open(os.path.join(reex, 'catalog.json')))}
mapping = json.load(open(map_path))
# Wrong-slot fixes found by the 2026-11-11 audit (orig | codex | new contact sheets).
OVERRIDES = {
    'campfire.png': ('camps-nature', 0, 7, 'prop'),          # was a wall torch tile (cave-props)
    'lanternPost.png': ('furniture-stations', 2, 3, 'prop'), # was a wall lantern tile (cave-props)
    'cross.png': ('camps-nature', 1, 4, 'prop'),             # was an altar
    'fence.png': ('finishing-details', 4, 2, 'prop'),        # was a plank bridge over water
    'archerTower.png': ('military-animal-buildings', 1, 3, 'prop'),  # was a second archery range
}
for k, (sh, r, c, md) in OVERRIDES.items():
    old = mapping[k]
    mapping[k] = dict(old, sheet=sh, row=r, column=c, mode=md)
# Restored from pre-autumn-runtime.zip (no fitting autumn cell): written by install step, skipped here.
RESTORE = ['pasture.png', 'pastureFat.png', 'pastureGrowing.png', 'sheepPasture.png', 'sheepPastureReady.png',
           'sheepPastureSheared.png', 'sheepPastureWoolly.png', 'townCenterMarker.png']
json.dump(mapping, open(os.path.join(out, '..', 'autumn-runtime-map.fixed.json'), 'w'), indent=1)
GRID_SHEETS = {'square-terrain', 'terrain-connections', 'cave-surfaces', 'bridges-water-roofs', 'floors-roofs-terrain', 'crops',
               'walls-doors', 'interior-walls', 'exterior-walls-damaged', 'interior-walls-damaged', 'cave-walls',
               'wall-kit-doors', 'wall-kit-windows', 'wall-kit-finishing', 'openings-fences-damage-xy'}
ACTOR_SHEETS = ['workers-a-transparent', 'workers-b', 'workers-c', 'village-life', 'specialists-npcs', 'infantry-v2', 'heavy-soldiers-v4',
                'mounted-units-v2', 'heroes', 'bandits', 'spear-pike-tiers', 'small-monsters', 'large-monsters', 'wildlife-v2', 'livestock',
                'young-animals-transport', 'wagons-riders', 'human-tasks', 'human-tasks-directions-a', 'human-tasks-directions-b',
                'human-life-directions', 'hero-tool-actions', 'animal-walks-a', 'animal-walks-b', 'animal-walks-c', 'animal-idle-eat-sleep',
                'combat-animation-completion']
PER_SHEET = {'workers-a-transparent', 'workers-b', 'workers-c', 'specialists-npcs', 'infantry-v2', 'heavy-soldiers-v4', 'mounted-units-v2',
             'heroes', 'bandits', 'spear-pike-tiers', 'human-tasks-directions-a', 'human-tasks-directions-b', 'human-life-directions',
             'hero-tool-actions', 'combat-animation-completion', 'human-tasks'}
import re

def library_mode(s):
    if s in ACTOR_SHEETS: return 'actor'
    if re.match(r'^(square-terrain|terrain-connections|cave-surfaces|bridges-water-roofs|floors-roofs-terrain|crops)$', s): return 'tile'
    if re.match(r'^(walls-doors|interior-walls|exterior-walls-damaged|interior-walls-damaged|cave-walls)$', s): return 'wall'
    if re.search(r'(effects|hit-effects)$', s): return 'effect'
    if re.match(r'^(ui-|resources-|equipment-)', s): return 'icon'
    return 'prop'

cells = {}
def cell(sheet, row, col):
    k = (sheet, row, col)
    if k not in cells:
        a = catalog[sheet]
        f = next(f for f in a['frames'] if f['row'] == row and f['column'] == col)
        im = np.asarray(Image.open(os.path.join(reex, 'frames', sheet, os.path.basename(f['file']))).convert('RGBA'))
        al = im[..., 3]
        ys, xs = np.nonzero(al > 24)
        q = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
        w = al[q[1]:q[3], q[0]:q[2]].astype(float)
        cx = (w.sum(0) * np.arange(q[2] - q[0])).sum() / w.sum() + q[0]
        cells[k] = (im, q, cx)
    return cells[k]

# actor groups: scale + half-width per (sheet,row) or per sheet
groups = {}
for s in ACTOR_SHEETS:
    a = catalog[s]
    per = {}
    for f in a['frames']:
        im, q, cx = cell(s, f['row'], f['column'])
        g = s if s in PER_SHEET else f'{s}/{f["row"]}'
        h = q[3] - q[1]
        half = max(cx - q[0], q[2] - cx)
        mh, mw = per.get(g, (0, 0))
        per[g] = (max(mh, h), max(mw, half))
    for g, (mh, mw) in per.items():
        sc = 116.0 / mh
        groups[g] = (sc, int(np.ceil(2 * mw * sc + 8)))

def group_of(sheet, row):
    return groups.get(sheet if sheet in PER_SHEET else f'{sheet}/{row}')

def render(sheet, row, col, mode):
    im, q, cx = cell(sheet, row, col)
    src = Image.fromarray(im).crop(q)
    qw, qh = q[2] - q[0], q[3] - q[1]
    if mode == 'actor':
        sc, w = group_of(sheet, row)
        h = 128
        dw, dh = max(1, round(qw * sc)), max(1, round(qh * sc))
        x = round(w / 2 - (cx - q[0]) * sc)
        x = max(0, min(w - dw, x))
        box = (x, 126 - dh)
    elif mode == 'furniture':
        w, h = 64, 96
        scl = min(64.0 / qw, 96.0 / qh)
        dw, dh = max(1, round(qw * scl)), max(1, round(qh * scl))
        box = ((w - dw) // 2, h - dh)
    else:
        w = 64 if mode == 'icon' else 128
        h = w
        scl = min((w - 4.0) / qw, (h - 4.0) / qh)
        dw, dh = max(1, round(qw * scl)), max(1, round(qh * scl))
        box = ((w - dw) // 2, (h - dh) // 2 if mode == 'effect' else h - dh)
    res = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    res.paste(src.resize((dw, dh), Image.NEAREST), box)
    if mode in ('actor', 'prop', 'furniture'):
        # Last guard against neighbour fragments: small blobs (<15% of the sprite) more than 6 px away go.
        from scipy import ndimage
        arr = np.asarray(res).copy()
        op = arr[..., 3] > 24
        lab, k = ndimage.label(ndimage.binary_dilation(op, np.ones((13, 13), bool)))
        if k > 1:
            sz = ndimage.sum(op, lab, range(1, k + 1))
            main = sz.max()
            for i, n in enumerate(sz, start=1):
                if n < 0.15 * main:
                    arr[lab == i] = 0
            res = Image.fromarray(arr)
    return res

written = 0
for s, a in catalog.items():
    if s in GRID_SHEETS: continue
    mode = library_mode(s)
    if mode in ('tile', 'wall'): continue
    for f in a['frames']:
        p = os.path.join(out, 'autumn', 'frames', s, os.path.basename(f['file']))
        os.makedirs(os.path.dirname(p), exist_ok=True)
        render(s, f['row'], f['column'], mode).save(p)
        written += 1
for name, m in mapping.items():
    if name in RESTORE or re.fullmatch(r'campfire\d\.png', name): continue
    if m['sheet'] in GRID_SHEETS or m['mode'] in ('tile', 'wall'): continue
    p = os.path.join(out, name)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    render(m['sheet'], m['row'], m['column'], m['mode']).save(p)
    written += 1
# Campfire animation: the stone-ring campfire with its flame (upper part) gently stretched per frame.
base = render('camps-nature', 0, 7, 'prop')
a = np.asarray(base)
ys = np.nonzero(a[..., 3] > 24)[0]
top, bot = ys.min(), ys.max() + 1
split = int(top + (bot - top) * 0.62)
for i, f in enumerate([1.0, 1.07, 0.95, 1.04]):
    fr = base.copy()
    flame = base.crop((0, top, 128, split))
    nh = max(1, round((split - top) * f))
    fr.paste((0, 0, 0, 0), (0, 0, 128, split))
    fr.alpha_composite(flame.resize((128, nh), Image.NEAREST), (0, split - nh))
    fr.save(os.path.join(out, f'campfire{i}.png'))
    mapping[f'campfire{i}.png'] = dict(mapping[f'campfire{i}.png'], sheet='camps-nature', row=0, column=7, mode='prop', note='flame stretched per frame')
    written += 1
json.dump(mapping, open(os.path.join(out, '..', 'autumn-runtime-map.fixed.json'), 'w'), indent=1)
print('written', written)
