# Re-extract source cells from the atlases by connected components instead of the fixed grid.
# usage: python -I reextract.py <src_root> <out_root>
# Writes <out_root>/frames/<sheet>/<row>-NN.png (unscaled, 2 px padding) and <out_root>/catalog.json with, per frame,
# 'atlasBox' (x0,y0,x1,y1 in atlas px of the cropped image incl. padding), 'opaqueBounds' (atlas px), 'method'.
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage
from skimage.segmentation import watershed

src_root, out_root = sys.argv[1:3]
GRID_SHEETS = {  # tiles / wall kits are meant to fill or join their cells: keep the grid cut
    'square-terrain', 'terrain-connections', 'cave-surfaces', 'bridges-water-roofs', 'floors-roofs-terrain', 'crops',
    'walls-doors', 'interior-walls', 'exterior-walls-damaged', 'interior-walls-damaged', 'cave-walls',
    'wall-kit-doors', 'wall-kit-windows', 'wall-kit-finishing', 'openings-fences-damage-xy'}
PAD = 2
catalog = json.load(open(os.path.join(src_root, 'catalog.json'), encoding='utf-8-sig'))
report = {}
for sheet in catalog:
    name = sheet['name']
    atlas = np.asarray(Image.open(os.path.join(src_root, sheet['source'])).convert('RGBA'))
    H, W = atlas.shape[:2]
    out_dir = os.path.join(out_root, 'frames', name)
    os.makedirs(out_dir, exist_ok=True)
    frames = sheet['frames']
    owner = np.full((H, W), -1, np.int32)  # cell index per pixel (grid)
    for i, f in enumerate(frames):
        x, y, w, h = f['rect']
        owner[y:y + h, x:x + w] = i
    rep = report.setdefault(name, {'merged': [], 'empty': [], 'multi': [], 'grid': name in GRID_SHEETS})
    al = atlas[..., 3]
    if name in GRID_SHEETS:
        assign = np.where(al > 0, owner, -1)
    else:
        mask = al > 24
        grown = ndimage.binary_dilation(mask, structure=np.ones((5, 5), bool))
        lab, n = ndimage.label(grown, structure=np.ones((3, 3)))
        lab = np.where(al > 0, lab, 0)  # keep faint pixels that sit inside a component's halo
        assign = np.full((H, W), -1, np.int32)
        objs = ndimage.find_objects(lab)
        singles = []  # (li, slice, cell, size) assigned whole by majority
        for li, sl in enumerate(objs, start=1):
            if sl is None:
                continue
            comp = lab[sl] == li
            own = owner[sl][comp]
            own_v = own[own >= 0]
            if own_v.size == 0:
                continue
            counts = np.bincount(own_v, minlength=len(frames))
            order = np.argsort(counts)[::-1]
            best, second = order[0], order[1] if len(order) > 1 else order[0]
            total = counts.sum()
            sub = assign[sl]
            if total > 400 and counts[second] > 0.05 * total:
                # Two sprites touch (or one spans cells): split the component by geodesic flooding from each
                # cell's core (the part of the component well inside a cell), so the cut runs through the bridge.
                own_sl = owner[sl]
                markers = np.zeros(comp.shape, np.int32)
                # First try: erode until the blob falls apart at its neck into big pieces that belong to
                # different cells; those pieces seed a watershed on the distance map (cut at the narrowest bridge).
                dist = ndimage.distance_transform_edt(comp)
                for r in range(1, 9):
                    l2, n2 = ndimage.label(dist > r, structure=np.ones((3, 3)))
                    if n2 < 2:
                        continue
                    sz = ndimage.sum(np.ones_like(l2), l2, range(1, n2 + 1))
                    big = [k + 1 for k in range(n2) if sz[k] >= 0.06 * total]
                    cells = {}
                    for k in big:
                        o = own_sl[l2 == k]
                        o = o[o >= 0]
                        if o.size:
                            cells[k] = int(np.bincount(o).argmax())
                    if len(set(cells.values())) >= 2:
                        for k, ci in cells.items():
                            markers[l2 == k] = ci + 1
                        break
                if markers.max():
                    ws = watershed(-dist, markers, mask=comp, connectivity=2)
                    sub[comp] = ws[comp] - 1
                    left = comp & (ws == 0)
                    sub[left] = own_sl[left]
                    rep['merged'].append([int(best), int(second), int(total), 'neck'])
                    assign[sl] = sub
                    continue
                for ci in np.nonzero(counts > 0.05 * total)[0]:
                    x, y, w, h = frames[ci]['rect']
                    mx, my = int(w * 0.18), int(h * 0.18)
                    core = np.zeros((H, W), bool)
                    core[y + my:y + h - my, x + mx:x + w - mx] = True
                    markers[comp & core[sl]] = ci + 1
                if markers.max() == 0:
                    sub[comp] = own_sl[comp]
                else:
                    ws = watershed(np.zeros(comp.shape), markers, mask=comp, connectivity=2)
                    sub[comp] = ws[comp] - 1
                    left = comp & (ws == 0)
                    sub[left] = own_sl[left]
                rep['merged'].append([int(best), int(second), int(total)])
            else:
                sub[comp] = best
                singles.append((li, sl, int(best), int(total)))
            assign[sl] = sub
        # Detached bits (a leg below a gap, hurt marks, dust) go with the NEAREST big sprite, not with whichever
        # grid cell holds most of their pixels (the grid often cuts through knees and feet).
        # Post-pass: per cell, the pieces of its selection; a piece that is not the cell's main sprite and sits
        # nearer to another cell's main sprite (a detached leg, a skirt hem split off at a neck) moves there.
        pieces = {}
        for i in range(len(frames)):
            x, y, w, h = frames[i]['rect']
            y0, y1, x0, x1 = max(0, y - h // 2), min(H, y + h + h // 2), max(0, x - w // 2), min(W, x + w + w // 2)
            sel = assign[y0:y1, x0:x1] == i
            if not sel.any():
                continue
            l2, n2 = ndimage.label(ndimage.binary_dilation(sel, structure=np.ones((5, 5), bool)) & True, structure=np.ones((3, 3)))
            l2 = np.where(sel, l2, 0)
            objs2 = ndimage.find_objects(l2)
            ps = []
            for k, sl2 in enumerate(objs2, start=1):
                if sl2 is None:
                    continue
                n = int((l2[sl2] == k).sum())
                gs = (slice(sl2[0].start + y0, sl2[0].stop + y0), slice(sl2[1].start + x0, sl2[1].stop + x0))
                ps.append((n, gs, (l2 == k), (y0, x0)))
            ps.sort(key=lambda t: -t[0])
            pieces[i] = ps
        def gap(a, b):
            dy = max(0, b[0].start - a[0].stop, a[0].start - b[0].stop)
            dx = max(0, b[1].start - a[1].stop, a[1].start - b[1].stop)
            return max(dx, dy)
        mains = {i: ps[0][1] for i, ps in pieces.items() if ps}
        moved = 0
        for i, ps in pieces.items():
            for n, gs, m, (y0, x0) in ps[1:]:
                g_own = gap(gs, mains[i])
                g, cb = min(((gap(gs, v), oc) for oc, v in mains.items() if oc != i), default=(1e9, i))
                if g < g_own and g <= 40:
                    ys, xs = np.nonzero(m)
                    assign[ys + y0, xs + x0] = cb
                    moved += 1
        rep['movedBits'] = moved
    for i, f in enumerate(frames):
        sel = assign == i
        fname = os.path.join(out_dir, os.path.basename(f['file']))
        if not sel.any():
            rep['empty'].append(i)
            x, y, w, h = f['rect']
            Image.fromarray(atlas[y:y + h, x:x + w]).save(fname)
            f['atlasBox'] = [x, y, x + w, y + h]
            f['method'] = 'grid-fallback'
            continue
        ys, xs = np.nonzero(sel & (al > 64)) if (sel & (al > 64)).any() else np.nonzero(sel)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        # crop the whole selection (incl. faint pixels) plus padding
        ys2, xs2 = np.nonzero(sel)
        cy0, cy1, cx0, cx1 = ys2.min(), ys2.max() + 1, xs2.min(), xs2.max() + 1
        img = np.zeros((cy1 - cy0 + 2 * PAD, cx1 - cx0 + 2 * PAD, 4), np.uint8)
        part = atlas[cy0:cy1, cx0:cx1].copy()
        part[~sel[cy0:cy1, cx0:cx1]] = 0
        img[PAD:PAD + cy1 - cy0, PAD:PAD + cx1 - cx0] = part
        Image.fromarray(img).save(fname)
        f['atlasBox'] = [int(cx0 - PAD), int(cy0 - PAD), int(cx1 + PAD), int(cy1 + PAD)]
        f['opaqueAtlas'] = [int(x0), int(y0), int(x1), int(y1)]
        f['method'] = 'grid' if name in GRID_SHEETS else 'components'
        if name not in GRID_SHEETS:
            # several large separate blobs in one cell (a neighbour's sprite assigned here?)
            l2, n2 = ndimage.label(ndimage.binary_dilation(sel & (al > 64), structure=np.ones((5, 5), bool)))
            if n2 > 1:
                sz = np.sort(ndimage.sum(sel & (al > 64), l2, range(1, n2 + 1)))[::-1]
                if sz[1] > 0.3 * sz[0] and sz[1] > 300:
                    rep['multi'].append(i)
json.dump(catalog, open(os.path.join(out_root, 'catalog.json'), 'w'), indent=0)
json.dump(report, open(os.path.join(out_root, 'reextract-report.json'), 'w'), indent=1)
for k, v in report.items():
    if v['merged'] or v['empty'] or v['multi']:
        print(k, 'merged', len(v['merged']), 'empty', v['empty'], 'multi', v['multi'])
