#!/usr/bin/env python3
"""Turn the sliced RimWorld/Stardew atlases (sprites/, normalised/) into game-ready files under
client/public/sprites/<group>/ (2026-11-09, SPRITES.md #90-#97).

Wired now (client/src/spriteRegistry.ts STRUCTURE_ART / ICON_ART):
  structure/  doors + windows baked onto the existing wood / stone wall straights (same 68 px/tile canvas as the
              wall pieces), floors / rug / roofs as 64x64 tiles (2x the 32 px grid), furniture fitted to one tile
              at 64 px/tile (drawn bottom-centred, upright like the walls).
  icons/      32x32 icons (room badges + stats, stockpile filters, tools, items, work, priority, needs, seasons).
Staged only (copied with clean names, not loaded by the game yet): extra furniture / doors / roof pieces in
structure/extra/, seasons/, weather/, crops/, animals/, villager/ (task animations), ui/.

Run: /tmp/claude-1000/venv/bin/python art-sources/rimworld-stardew/wire_sprites.py  (needs Pillow + numpy)
"""
import json
import os
import shutil
from collections import deque

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SRC = os.path.join(HERE, "sprites")
NORM = os.path.join(HERE, "normalised")
OUT = os.path.join(ROOT, "client", "public", "sprites")
WALLS = OUT  # the existing connected-wall pieces (woodWall_NN.png / stoneWall_NN.png)
T = 64  # px per tile for tile-sized art (the game tile is 32; 2x keeps detail at zoom 1.3+)


def load(atlas, name):
    return Image.open(os.path.join(SRC, atlas, name + ".png")).convert("RGBA")


def despeck(im, min_px=12):
    """Drop alpha islands smaller than min_px (stray specks from neighbouring sprites)."""
    a = np.array(im)
    mask = a[:, :, 3] > 24
    seen = np.zeros_like(mask)
    h, w = mask.shape
    for y in range(h):
        for x in range(w):
            if not mask[y, x] or seen[y, x]:
                continue
            comp = []
            q = deque([(y, x)])
            seen[y, x] = True
            while q:
                cy, cx = q.popleft()
                comp.append((cy, cx))
                for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
            if len(comp) < min_px:
                for cy, cx in comp:
                    a[cy, cx, 3] = 0
    a[a[:, :, 3] <= 24] = 0
    return Image.fromarray(a)


def trim(im):
    bb = im.getbbox()
    return im.crop(bb) if bb else im


def crisp(im):
    """Hard 1-bit alpha (no soft fringe once nearest-scaled in game), fully transparent pixels zeroed."""
    a = np.array(im)
    a[:, :, 3] = np.where(a[:, :, 3] >= 128, 255, 0)
    a[a[:, :, 3] == 0] = 0
    return Image.fromarray(a)


def fit(im, max_w, max_h):
    im = trim(despeck(im))
    s = min(max_w / im.width, max_h / im.height)
    size = (max(1, round(im.width * s)), max(1, round(im.height * s)))
    return crisp(im.resize(size, Image.BOX if s < 1 else Image.NEAREST))


def tile(im, border, size=T):
    """An opaque square tile: crop the outline / bevel off the edges, box-downscale to size x size."""
    im = trim(im)
    im = im.crop((border, border, im.width - border, im.height - border))
    out = im.resize((size, size), Image.BOX).convert("RGBA")
    a = np.array(out)
    a[:, :, 3] = 255
    return Image.fromarray(a)


def icon(im, size=32):
    im = trim(despeck(im))
    s = min(size / im.width, size / im.height)
    small = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.BOX)
    out = Image.new("RGBA", (size, size))
    out.alpha_composite(small, ((size - small.width) // 2, (size - small.height) // 2))
    return out


def save(im, group, name):
    d = os.path.join(OUT, group)
    os.makedirs(d, exist_ok=True)
    im.save(os.path.join(d, name + ".png"), optimize=True)


def copy(atlas, name, group, new_name, normalised=False):
    src = os.path.join(NORM if normalised else SRC, atlas, name + ".png")
    d = os.path.join(OUT, group)
    os.makedirs(d, exist_ok=True)
    shutil.copyfile(src, os.path.join(d, new_name + ".png"))


# ---- doors / windows on the wall straights ----
def wall(material, mask):
    return Image.open(os.path.join(WALLS, f"{material}Wall_{mask:02d}.png")).convert("RGBA")


def doorway(door):
    """An open doorway in the door's silhouette: dark opening, the leaf swung back against the left jamb."""
    a = np.array(door)
    inside = a[:, :, 3] > 0
    out = np.zeros_like(a)
    out[inside] = (34, 24, 16, 255)
    # Keep the outer outline ring (dark) and the bottom threshold.
    ring = inside & ~(np.roll(inside, 2, 0) & np.roll(inside, -2, 0) & np.roll(inside, 2, 1) & np.roll(inside, -2, 1))
    out[ring] = (14, 10, 8, 255)
    im = Image.fromarray(out)
    leaf = door.resize((max(4, door.width * 3 // 10), door.height), Image.BOX)
    im.alpha_composite(crisp(leaf), (0, 0))
    return im


def on_wall(material, horizontal, piece, rel_h, rel_bottom=0.0, rel_w=None):
    """Bake `piece` into the wall straight (E-W mask 10 or N-S mask 5) of that material."""
    base = wall(material, 10 if horizontal else 5)
    x0, y0, x1, y1 = base.getbbox()
    bw, bh = x1 - x0, y1 - y0
    piece = trim(despeck(piece))
    h = round(bh * rel_h)
    w = round(bw * rel_w) if rel_w else round(piece.width * h / piece.height)
    p = crisp(piece.resize((w, h), Image.BOX))
    base.alpha_composite(p, ((base.width - w) // 2, y1 - h - round(bh * rel_bottom)))
    return base


def doors_and_windows():
    plank = trim(despeck(load("town", "door_wood_plank_closed_a")))
    stone_closed = load("town", "door_wood_stonearch_closed")
    stone_open = load("town", "door_wood_stonearch_open_a")
    wood_open = doorway(plank)
    win_wood = load("town", "window_wood_glass_a")
    win_stone = load("town", "window_stone_arch_a")
    for mat, closed, opened, win in (("wood", plank, wood_open, win_wood), ("stone", stone_closed, stone_open, win_stone)):
        save(on_wall(mat, True, closed, 0.92), "structure", f"door_{mat}_h_closed")
        save(on_wall(mat, True, opened, 0.92), "structure", f"door_{mat}_h_open")
        # N-S wall: the door seen edge-on, squashed into the column's face.
        save(on_wall(mat, False, closed, 0.62, 0.02, rel_w=0.78), "structure", f"door_{mat}_v_closed")
        save(on_wall(mat, False, opened, 0.62, 0.02, rel_w=0.78), "structure", f"door_{mat}_v_open")
        save(on_wall(mat, True, win, 0.62, 0.16), "structure", f"window_{mat}_h")
        save(on_wall(mat, False, win, 0.45, 0.22, rel_w=0.62), "structure", f"window_{mat}_v")


# ---- floors, rug, roofs (64x64 tiles) ----
def tiles():
    for i in (1, 2, 3):
        save(tile(load("town", f"floor_wood_a_{i}"), 6), "structure", f"floor_wood_{i}")
        save(tile(load("town", f"floor_flagstone_{i}"), 6), "structure", f"floor_stone_{i}")
    # Rug: keep its gold border (inset 3 px of floor showing round it, so side-by-side rugs read as separate mats).
    rug = trim(despeck(load("town", "rug_red_1")))
    rug = crisp(rug.resize((T - 8, T - 8), Image.BOX))
    canvas = Image.new("RGBA", (T, T))
    canvas.alpha_composite(rug, (4, 4))
    save(canvas, "structure", "rug")
    # Roofs: the slope's middle, cropped square (ridge / eave pieces are staged in structure/extra).
    for name, src in (("roof_thatch", "roof_thatch_slope"), ("roof_tile", "roof_clay_slope"), ("roof_slate", "roof_slate_slope")):
        im = trim(load("town", src))
        m = im.width // 6
        save(tile(im.crop((m, m, im.width - m, im.height - m)), 0), "structure", name)


# ---- furniture (fitted to one tile at 64 px/tile, drawn bottom-centred) ----
FURNITURE = {
    # game piece: (atlas sprite, max width, max height) at 64 px per tile
    "bed": ("bed_blue_single", 60, 64),
    "table": ("table_small", 52, 52),
    "chair": ("chair", 26, 46),
    "chest": ("chest_closed", 50, 48),
    "shelf": ("bookshelf", 44, 70),
    "hearth": ("fireplace_lit_a", 60, 66),
    "lamp": ("candelabra_a", 30, 66),
    "workbench": ("workbench", 62, 56),
    "statue": ("statue_stone", 38, 74),
    "weapon_rack": ("weapon_rack", 50, 62),
}
EXTRA_FURNITURE = [
    "bed_blue_double", "bed_red_single", "bed_straw", "table_long", "stool", "bench", "chest_locked", "wardrobe",
    "fireplace_lit_b", "stove_iron", "cauldron", "oven_round", "brazier_pot", "campfire_cauldron", "candelabra_b",
    "candelabra_c", "candelabra_d", "lantern", "banner_blue", "banner_red", "banner_post_blue", "armor_stand",
    "altar_candles", "well_stone", "barrel", "sacks_pile", "crates_barrels_stack", "storage_rack_fence", "jar_clay",
    "plant_pot", "cart_produce", "hay_pile_crate", "market_crates_small", "stall_market_blue", "stall_market_red",
    "signpost_hanging", "frame_hut_wood", "scaffold_frame",
    "door_iron_closed", "door_iron_arched_closed_a", "door_barred_closed_a", "door_wood_arched_closed",
    "door_wood_plank_closed_b", "door_wood_stonearch_open_b", "door_wood_stonearch_open_c", "door_wood_stonearch_open_d",
    "window_shutters_a", "window_shutters_b", "window_stone_stained_a", "window_wood_glass_b",
    "roof_thatch_corner", "roof_thatch_ridge_pair", "roof_thatch_peak", "roof_clay_corner", "roof_clay_ridge_pair",
    "roof_slate_corner", "roof_slate_ridge_pair", "roof_slate_peak", "roof_slate_blue_peak",
    "floor_dirt_1", "floor_dirt_2", "floor_dirt_3", "floor_wood_b_1", "floor_wood_b_2", "floor_wood_b_3",
    "rug_red_2", "rug_red_3", "rug_blue_1", "rug_blue_2", "rug_blue_3",
]


def furniture():
    for piece, (src, w, h) in FURNITURE.items():
        save(fit(load("town", src), w, h), "structure", piece)
    for name in EXTRA_FURNITURE:
        save(trim(despeck(load("town", name))), "structure/extra", name)


# ---- icons (32x32) ----
ICONS = {
    # room roles (RoomRole) and stats
    **{f"room_{r}": f"badge_room_{r}" for r in ("bedroom", "barracks", "kitchen", "workshop", "hall", "storeroom", "church", "hospital", "castle")},
    **{f"stat_{s}": f"icon_room_{s}" for s in ("size", "beauty", "cleanliness", "warmth", "wealth")},
    # stockpile filters (StockCategory)
    **{f"stock_{c}": f"icon_stockpile_{c}" for c in ("food", "wood", "stone", "ore", "metal", "cloth", "tools", "weapons", "armour", "medicine")},
    # Stardew hero tools (future) + item icons
    **{f"tool_{t}": f"tool_{t}" for t in ("axe", "hoe", "pickaxe", "scythe", "seedbag", "watering_can")},
    **{f"item_{i}": f"item_{i}" for i in ("egg", "hay_bale", "milk_bucket", "milk_pail", "shears", "water_trough", "wool_bundle")},
    # work types + priorities (phase 4)
    "work_farming": "icon_work_wheat_farming", "work_hauling": "icon_work_barrel_hauling", "work_building": "icon_work_hammer_building",
    "work_crafting": "icon_work_plank_crafting", "work_mining": "icon_work_pickaxe_mining", "work_harvest": "icon_work_scythe_harvest",
    **{f"priority_{p}": f"priority_{p}" for p in ("1", "2", "3", "4", "off")},
    # needs, seasons, weather, festival
    **{f"need_{n}": f"icon_need_{n}" for n in ("happy", "heart", "sick", "thirst")},
    **{f"season_{s}": f"icon_season_{s}_small" for s in ("spring", "summer", "autumn", "winter")},
    **{f"season_{s}_large": f"icon_season_{s}_large" for s in ("spring", "summer", "autumn", "winter")},
    "weather_rain": "icon_weather_rain_small", "festival": "icon_festival_bunting",
}
VILLAGER_ICONS = {"need_hungry": "icon_status_hungry", "need_tired": "icon_status_tired_zzz"}


def icons():
    for name, src in ICONS.items():
        save(icon(load("builder", src)), "icons", name)
    for name, src in VILLAGER_ICONS.items():
        save(icon(load("villager", src)), "icons", name)


# ---- staged only ----
def staged():
    manifest = json.load(open(os.path.join(HERE, "manifest.json")))
    for e in manifest["sprites"]:
        atlas, group, name = e["atlas_short"], e["group"], e["name"]
        if atlas == "builder" and group in ("seasons", "weather", "crops", "animals"):
            copy(atlas, name, group, name)
        elif atlas == "builder" and group == "animations" and name.startswith("villager_haul"):
            copy(atlas, name, "villager", name.replace("villager_", "farmer_"), normalised=True)
        elif atlas == "villager" and group == "animations":
            copy(atlas, name, "villager", name.replace("villager_", ""), normalised=True)
        elif atlas == "villager" and group == "ui":
            if name.startswith("ui_"):
                copy(atlas, name, "ui", name[3:])


if __name__ == "__main__":
    doors_and_windows()
    tiles()
    furniture()
    icons()
    staged()
    print("done")
