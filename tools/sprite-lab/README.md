# Sprite Lab

A local web app for The Sworn Game's sprite parts: slice and edit part sets, set pivots and bone lengths, recolour with
the game's own ramps, draw with an embedded pixel editor, animate the player rig with clips (keyframes as data), and compare
the assembled body with real game art.
It is a tool, not part of the game build. Spec: `~/docs/colony2d/SPEC-sprite-lab.md`.

## Start

```
npm run lab                         # http://127.0.0.1:5180/  (prints the URL)
PORT=5190 npm run lab               # another port (8080 / 5173 / 5175 are refused)
npm run lab -- --root /some/copy    # or LAB_ROOT=/some/copy: work on a copy of the repo instead of the repo
```

Nothing to build first: the app is served through Vite (middleware mode) and the Draw editor is a committed bundle.
Uses the repo's own `vite` and `typescript`; no extra dependencies. Node 22 runs the `.ts` server directly.

## Tabs

- **Parts**: pick a set (`client/public/rig/parts/<set>/`), list of parts with thumbnails in draw order, a big pixel view
  (1x-16x, pan, grid). Drag the red **pivot**; drag the yellow **joint** (bone end = pivot + length along the part axis:
  down for limbs, up for torso / head / pelvis / hair / helm) to set `len`. Alt+drag grabs the joint when it sits under
  the pivot (len 0); Shift snaps to whole pixels (default: half pixels). Fields: name, pivot, bone length, joint name,
  variant, scale, size (from the PNG). Add / Duplicate / Rename / Delete, Up / Down or drag to reorder (draw order is
  kept in the set's `lab.json`; the game ignores it, manifests have no order field). Recolour: skin / hair swatches and
  "far" darkening, `preview` shows it, `Bake` writes it into the part. Import PNG (replaces the pixels, keeps the pivot)
  and Import sheet (sheet PNG + a layout from `scripts/rig-layouts/`, runs `scripts/slice-rig-sheet.mjs`). The
  right-hand panel shows the assembled body from `rig/body.html?parts=<set>` (saved files) at the in-game size, 1x/2x/4x.
- **Draw (based on Piskel)**: Piskel in an iframe. "Edit this part in Draw" opens a part (optionally a neighbour part as a
  faint Reference layer, aligned at the pivot; it is never saved). Piskel's layers, frames, onion skin, mirror pen,
  fill, shapes, palettes and undo all work as in Piskel (click the canvas first so its shortcuts get the keys).
  "Send back to Parts" writes the current frame (all layers except Reference) into the set and saves: the PNG, the
  manifest size; the pivot is kept. "New part" opens a blank canvas (default 32x32); on Send back the part is created
  with its pivot at the centre-bottom. The side strip shows the drawing at the in-game size (x0.275 = body.html x1.08
  times game x0.255) beside the hero sprite `autumn/frames/heroes/base-05.png` (x0.255) on grass, 1x/2x/4x.
- **Rig**: clips (`client/public/rig/clips/*.json`) on the human skeleton, played on the assembled body. See "Rig tab".
- **Area**: the game's bandit camp, building and settlement templates (`server/data/<kind>/`), painted with the game's
  tile art, validated live by the game's validators, previewed with the real server stamper. See "Area tab".
- **Compare**: set + look (pose, helm, shield, hair, time; or a Clip and its phase `u`, drawn by the Rig renderer) of the
  assembled body beside any reference sprite from
  `client/public/sprites/` at the in-game size, 1x/2x/4x, with a height ruler (game pixels) and grid, and the
  validators v1 report for the set.

## Shortcuts

| Key | Action |
| --- | --- |
| Ctrl+S | Save the set (Rig tab: save the clip) |
| Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y | Undo / redo (Parts, Rig; inside Draw, Piskel's own undo) |
| + / - / 0 | Zoom in / out / fit (Parts view) |
| G | Grid on/off |
| Up / Down arrows | Previous / next part |
| Alt+1 ... Alt+5 | Switch tab (Area = Alt+4; its own keys are in "Area tab") |
| Mouse wheel | Zoom at the cursor; drag empty space (or middle / right button) to pan |

The orange dot in the header means unsaved changes (the browser also warns before leaving).

## Rig tab

Left: the clip list (New, Duplicate, Rename, Delete; `ref` = built-in, read-only, Duplicate to edit) and the Look (part
set, weapon none / sword / axe / spear / bow, helm 0-3, armour tier, gender, build, shield, hair). Centre: the live canvas,
the toolbar (Play / Pause, Loop, speed, frame step, onion skin, bones, zoom, Export contact sheet, Bake atlas preview,
unsaved dot, Save clip) and the timeline. Right: the keyframe inspector (channel, phase, value, ease), pose Copy / Paste,
Mirror L/R, clip settings (duration, fps, phases, loops), limb modes, events, live channel values.

- **Rendering** is `app/src/rig/render.ts`: it loads `/rig/rig-core.js` itself (never a copy) and repeats
  `rig/body.html`'s part placement (`build()`, `drawFrame()`, `withBg()`, `__rig.sheet()`) with the hard-coded motion
  replaced by the clip. Parts come from the SAVED set files, like body.html. Sword, helm and shield are body.html's
  harvested pieces; axe / spear / bow are the set's own parts (heroRig.ts's angle offsets and width scales); armour tiers,
  gender (torsoF / headF) and build (heroRig's width / height factors as one scale) are extras body.html does not have.
- **Canvas**: dashed ground line; under each foot a green bar = planted (on the ground, not swinging), an orange outline =
  airborne; a red cross / circle = an IK target the limb cannot reach. Coloured handles: hips (root.x / root.y), neck
  (spine.lean), above the head (head.tilt), weapon tip (armN.weapon), hands and feet (IK target, or for FK limbs the
  shoulder + elbow / hip + knee solved by `Rig.ik2`), elbows and knees of FK limbs (the upper bone angle). Dragging keys the
  channels at the playhead (the waves of a track are subtracted, so the pose lands where you drop it). Onion skin: the
  previous / next phase in red / blue. Top right: the frame at the in-game size, x2 and x1.
- **Timeline**: ruler in phases (`phases`) and frames (`fps x duration`), events as triangles; one row per channel
  (animated channels first, `~` = it also has waves). Drag the ruler to scrub; click a key to select it, drag it (snaps to
  frames, Alt = free, cannot pass its neighbours); double-click a row to add a key. Key colours show the ease.
- **Exports** (download or save to `art-sources/lab/exports/<clip>-contact.png` / `<clip>-atlas.png`): the contact sheet
  uses the layout of `scripts/character-rig-contact.mjs` (a labelled cell per phase, source frame plus the same frame at
  the in-game size, one row per look: this look / armour tiers 0-3 / male-female x 3 builds). The baked atlas is every
  frame (`round(duration x fps)`) at the in-game size (frame x0.255 = part x0.275, the Draw tab's factor), with an
  animated 1x / 2x / 4x preview.

| Key (Rig tab) | Action |
| --- | --- |
| Space | Play / pause |
| Left / Right | Previous / next frame |
| K / Shift+K | Key the selected channel / every animated channel at the playhead |
| Delete | Delete the selected key |
| Ctrl+C / Ctrl+V | Copy / paste the pose (all animated channels) |
| Ctrl+Z, Ctrl+Y, Ctrl+S | Undo, redo, save the clip |

### Clip format (`sworn-clip/1`, `shared/clip.ts`)

```jsonc
{
 "format": "sworn-clip/1", "name": "walk",          // name = file name, ^[a-z0-9][a-z0-9_-]{0,40}$
 "skeleton": "human",                                 // client/public/rig/skeletons/human.json
 "loop": true, "duration": 0.8696, "fps": 24, "phases": 8,
 "builtin": true, "source": "...",                    // built-ins only (the server refuses to write them)
 "tracks": {                                          // channel -> keys (+ optional waves)
  "armN.shoulder": { "keys": [ {"u": 0, "v": 14} ],  // u = phase 0..1, v = degrees / px
                     "waves": [ {"fn": "sin", "amp": 5, "rate": 6.283, "per": "cycle"} ] }
 },
 "limbs": { "legN": {"mode": "ik", "gait": {"stride": 22, "lift": 8, "duty": 0.58, "phase": 0, "tilt": {"above": 2, "up": -14, "down": 10}}},
            "armF": {"mode": "ik", "target": "grip", "along": 30} },
 "weapon": { "kind": "sword", "trail": {"from": 0.5, "to": 0.78, "steps": 7, "step": 0.018}, "release": 0.74, "shield": false },
 "events": [ {"u": 0.62, "type": "contact", "note": "strike"} ]
}
```

- Channels: `root.x` `root.y` (px, + = forward / down), `pelvis.tilt`, `spine.lean`, `head.tilt`; per arm (`armN` near /
  weapon arm, `armF` far / shield arm) `shoulder`, `elbow` (relative to the upper arm), `ikX`, `ikY` (IK target from the
  shoulder); `armN.weapon` (absolute weapon angle); per leg (`legN`, `legF`) `hip`, `knee` (FK), `ankle` (foot tilt),
  `ikX` (foot target from the hip), `ikY` (lift above the ground); `weapon.draw` (bow 0..1). A channel without a track
  takes the skeleton's `rest` value. Angles: rig-core's convention, 0 = down, + = forward, 180 = up.
- Keys use rig-core's `Rig.kf`: the ease belongs to the TARGET key (`smooth` = cubic Hermite with flat tangents, the
  default; `linear`, `easeIn`, `easeOut` cubic; `step` = hold). Loops also interpolate across the seam (last key -> first
  key + 1). One-shots hold the first / last key outside the keyed range.
- Waves (`sin`, `cos`, `abssin`, `abscos`): `amp * fn(rate * x + phase)` added to the keyed value; `x` = loops since the
  start (`per: "cycle"`, unwrapped, so 6.2832 = once per loop) or seconds (`per: "second"`). They reproduce body.html's
  bob / sway / wobble exactly (its idle wobble is in seconds and not tied to a cycle).
- Limbs: `mode` `fk` or `ik` (two-bone `Rig.ik2`; `bend` +1 / -1, default from the skeleton: knees +1, elbows -1).
  IK `target`: `free` (the limb's `ikX` / `ikY`), `grip` (far hand on the weapon `along` px from the weapon hand: spear),
  `string` (near hand on the bow string: `lerp(bow hand + string.from, shoulder + string.to, weapon.draw)`). `gait` adds
  `Rig.foot` (planted-foot walk) to a leg's target, `cycles` per loop, and its `tilt` sets the swing foot's angle.
- Validation is strict on every known field (types, ranges, channel / limb / ease / event names, keys strictly increasing)
  and happens on load and on save (the server answers 400 with the reasons). Unknown fields are allowed and kept where
  they are, so newer files survive a round trip. Files are written by `formatClip()`: 1-space indent, one key per line.
- The skeleton (`client/public/rig/skeletons/human.json`) holds the frame and ground point, torso heights, hips, hand
  reach, rest values, bend signs, shield pose and weapon rules; bone LENGTHS come from the part set's manifest.

### Built-in clips and the equivalence test

`node tools/sprite-lab/scripts/make-builtin-clips.ts` writes `idle`, `walk`, `attack-sword` (from body.html: `K`, the walk
and idle formulas) and `attack-axe`, `attack-spear`, `attack-bow` (from index.html's `ATTACK` tables and off-hand rules;
body.html has no other weapons). `test/rig-golden.test.ts` renders idle / walk (incl. a second loop) / sword attack, with
and without helm and shield, through both body.html's `__rig.sheet()` and the Lab renderer in the same browser and
requires identical pixels; for axe / spear / bow it records index.html's own draw calls and requires its angles to equal
the clip channels and the clip's IK rules (solved with index.html's bone lengths).

### How the game will use clips (next step, not in this round)

`client/src/heroRig.ts` still has its own hard-coded motion (`keyframes` / `motion` tables per weapon). Moving it onto
clips needs: (1) load `rig/skeletons/human.json` and the clip JSONs with the atlas; (2) port `sampleClip` /
`solvePose` (`shared/clip.ts`, `shared/pose.ts`, pure TypeScript, no DOM) or import them; (3) a clip per HeroPose state
(`idle`, `walk`, `attack-<weapon>`, `hurt`, mounted variants) and heroRig's quantisation (`36 / 32 / 12` phases) mapped to
`phases`; (4) re-express heroRig's extras as data or skeleton rules (its cubic `motion()` with neighbour tangents is NOT
rig-core's `kf`: add an ease such as `catmull` or bake its curves into keys; its hand-space arcs for sword / axe; its
shield arm and torso fitting); (5) golden contact sheets before / after with `scripts/character-rig-contact.mjs`
(SPEC stage 0) so the switch is behaviour-preserving.

## Area tab

Left: kind (Bandit camps / Buildings / Settlements; stage B: Forts / sites, Castle Ruin, POI pools, Interiors), search, tier and built-in / user filters, the template list
(badges: built-in, user, tier, type, size, `invalid`, `shadowed` = a user file with a built-in's id, which the game skips),
New (the in-game editors' defaults), Duplicate, Delete (user only), Import JSON, Export JSON. Centre: the toolbar, the
grid (PixelView: wheel zoom 3-72 px per cell, middle-drag or Space + drag pans), the validation panel and the stats /
hover line. Right: the palette (every legend symbol with its game sprite; left button paints, right button erases to
open ground), the building library (settlements), the template's fields, the Save box (the exact file it writes).

- **Files**: built-ins `server/data/{camps,buildings,settlements}/*.json` are READ-ONLY (opening one shows it with a
  "Duplicate to user…" banner; any edit asks for a new id first). Saves go to `server/data/<kind>/user/<id>.json`, the
  folder the game's template stores load at boot and the in-game creative editors (campEditor.ts, buildingEditor.ts,
  settlementEditor.ts) save to; both editors work on the same files. The file is written exactly like the game's store
  writes it (`normalise` + `JSON.stringify(t, null, 2)`), atomically, the previous file backed up. The server
  re-validates every save with the game's validator and refuses a built-in's id, an existing user id unless it is the
  template you opened (and unchanged on disk since, else "reload"), bad ids (`^[a-z0-9][a-z0-9_-]{0,47}$`).
- **Tools** (keys): Pencil P, Line L, Rectangle R (`filled`, Shift flips it), Fill F (4-way flood), Eyedropper I,
  Select S (drag a box; drag inside it to move it; Ctrl+C / Ctrl+X, Ctrl+V then click to paste; Delete clears it), Place
  building B (settlements). M / Shift+M toggle mirror painting left-right / top-bottom (blue axis lines). ⟳ ⟲ ⇋ ⇵ turn or
  mirror the selection, or the whole template with the game's `transformRows` (camps / buildings turn their entrance /
  door side with it, settlements use the game's `transformSettlement`, which moves and re-turns the buildings).
  Resize… (any size, anchor of 9; settlement buildings shift with the content), Clear. Ctrl+Z / Ctrl+Y, Ctrl+S, + / - / 0,
  G grid, V stamp preview, Esc drops the selection / paste / building.
- **Single anchors**: a camp has exactly one hearth `H`, a settlement one keep `K` (or a keep building's anchor `Y`):
  painting `H` / `K` MOVES it (the toast says so). Erasing it is allowed and the validator then says so.
- **Settlement buildings**: click a library card (or drag it onto the map); a ghost follows the cursor (green fits,
  red collides) and a click places it centred on the cursor (the game's `buildingOrigin` rule). Click a placed building
  to select it (thick outline), drag to move (snaps to cells), R / M turn / mirror it (refused when the building
  template's `rotate` / `mirror` flag forbids it), Delete removes it, "Edit template" opens it in the Buildings kind.
  Footprints are dashed green, colliding cells red (off the grid, on another building, on a ground symbol: the same
  rules as the game's `settlementLayout`, which stays the verdict). `spriteBuildings` settlements use the game's 3x3
  prefab footprint (`spriteBuildingCells`).
- **Validation**: the game's `validateCampTemplate` / `validateBuildingTemplate` / `validateSettlementTemplate` run
  ~140 ms after every edit (settlements with the game store's building lookup: built-ins + valid user buildings).
  Messages naming a cell ("at x,y") or a building ("building 3 ...") are links: the view jumps there and flashes the
  cell / selects the building. Lab warnings (weight 0, a built-in's id, colliding buildings) are amber. Save is
  disabled while there are errors.
- **Stamp preview** (V): a strip of every transform world-gen may use (camps: `pickCampTransform`'s rotate / mirror
  flags; settlements: `settlementTransforms`; buildings: the placements their flags allow). Source:
  - "Shared code" (instant): `campCells` around the hearth (camps), `transformSettlement` + `settlementLayout` with the
    stamper's apron and ownership rule (settlements), `buildingCells` (buildings): the same shared functions the
    server stamper calls. `test/area-game.test.ts` proves it equals the real stamper cell for cell (tiles + ownership).
  - "Real server stamper" (camps, settlements): `server/stamper/worker.ts` runs the game's own `stampCamp` /
    `stampSettlement` (+ the template stores) in a child process with the repo's tsx on an empty 160x160 in-memory map
    (scratch COLONY_SAVE_DIR, deleted after; no port, no save) and returns tiles, ownership, site grounds, spawned
    guards, the hearth / site record (name, homes, posts). `seed` drives the stamper's random picks. It uses the
    repo's built-ins and the Lab root's user buildings.
  Overlays: ownership (blue), grounds (white), slot / guard / keep / hearth markers, footprints, entrance arrow.
- **Art** (`app/src/area/art.ts`): imported from the game, not copied: `TILE_SPRITE_FILES`, `TILE_OPTIONAL_ART`,
  `TILE_STANDIN_TINT` (client/src/worldVisuals.ts) and `STRUCTURE_FURNITURE_ART` + door / window / floor URLs
  (client/src/spriteRegistry.ts), with the build toolbar's icon rule (furniture art, else optional art, else the tinted
  stand-in). Doors / windows pick the h / v sprite from their wall neighbours; 2-cell furniture draws across both cells.
  Not reproduced: wall / fence / road autotiling, floor variants, roofs, campfire animation, tent faction variants.
  Every legend symbol that stamps a tile has art; the ones without are markers by design (open ground `.`, slots
  `g m a e p` / `t r v g q`, settlement `u` animal-zone ground). The palette footnote lists it live.

### Area tab, stage B kinds (forts / sites, Castle Ruin, POI pools, building interiors)

The game moved this content from TypeScript to JSON (`STAGE-B-DATA-2026-11-26.md`); the same Area tab edits it. Every
rule is the game's shared code: `validateSiteTemplate` / `validatePoiTemplate` / `validateCastleRuin` (with the mob
kinds = keys of shared `MOB_ROLE`, tested equal to the server's `MOB_KIND_CONFIG`), `validateInteriorFile` +
per-layout `validateInteriorTemplate`, the `normalise*` functions, the legends (`SITE_TEMPLATE_TILES` + a file's own
`symbols`, the castle's `tiles`, `INTERIOR_LEGEND`), `transformRows`, `buildInteriorMap`, and on the server
`stampSiteTemplate` / `placePoiSite`. Model: `shared/areaData.ts`; UI: `app/src/area/{forms,interior}.ts` + tab.ts.

| Kind | Built-ins (read-only) | Saves to | Editor | Preview |
| --- | --- | --- | --- | --- |
| Forts / sites | `server/data/sites/*.json` (thornwick, grakkar, hearthmoor, ironhold, riverwatch) | `server/data/sites/user/<id>.json` | grid with two grids ("Grid: Tiles / Tiers"; they resize / turn together); fields: faction, label, noun, names (pick order), max / start tier, garrison (spawn order, drag), workers, stock, rebuild cost, own symbols (+ "Human set") | the REAL `stampSiteTemplate` at the chosen tier (scratch child process; the edited file is put into `SITE_TEMPLATES` there): tiles, ownership, grounds, garrison, keep |
| Castle Ruin | `server/data/castle-ruins/castle-ruin.json` | `server/data/castle-ruins/user/<id>.json` | grid (square, odd, 5-15; `B` the boss: exactly one, the centre, the pencil moves it); fields: boss, guardians min-max, spawn distances (ordered), guardian weights (ordered), tiles map | shared-code view (tiles with art, the boss, the grounds ring); `placeCastleRuin` is not run (it reads only the built-in) |
| POI pools | `server/data/pois/{ruin,encampment}.json` | `server/data/pois/user/<id>.json` | a form (no grid): centrepieces + extras as ordered lists (drag / arrows / add / remove), extra count, guardian count, guardian weights (ordered), footprint radius; "ORDER MATTERS" warning | 6 samples of world-gen's own `placePoiSite("ruin")` with the edited pool (RUIN_POI's fields set in the scratch child), seeded |
| Interiors | `shared/src/data/interiors/<house…barn>.json` | THE SAME FILE (no user/ layer) | grid per layout ("Layout: Variant 0 / 1 / 2 / Upstairs"; the number is the index `interiorVariantFor` returns), move / add / remove variant, + / − upstairs; fields: required stations (hall: throne / table / chest locked), sleep, the layout's label / floor / wall | the game's `buildInteriorMap(id, level, variant, storey)` at level 1-3 (with the edge furnishings), run with the edited layouts (swapped into the loaded tables for the call, then restored) |

- **World-gen does not use user sites / POI pools / castle ruins yet** (amber banner + list badge "not in world-gen"):
  user site templates load into `SITE_TEMPLATES` and can be stamped from creative mode, but `generateForts` names its
  ids and a settlement's `profile` is the closed list hearthmoor / ironhold / riverwatch; user POI files are loaded and
  validated (`poiTemplateFiles`) but `placePoiSite` reads only the built-in `ruin` pool (`encampment` stamps a tier-1 camp
  template instead; the encampment pool's extras are the camp-hearth burnable tiles in hearths.ts); `placeCastleRuin`
  reads only the built-in `castle-ruin`. Changing that is a later game change.
- **Interiors edit the game** (red banner, always on): "This edits the game's built-in interiors; client and server both
  read these files at build time; restart the server and rebuild the client; revert with git." Save asks to confirm,
  then `POST /api/interiors/<id>/save` writes the file after: the nine exact names only (never `legend.json`, never a
  new file), `validateInteriorFile` (incl. the hall invariant), the hash you opened must still be the file on disk (else
  409), the game's `normaliseInteriorFile` + `JSON.stringify(f, null, 2) + "\n"` (the files' own format: an untouched
  file saves byte-identical), a backup in `art-sources/lab/backups/<time>/shared/src/data/interiors/`, an atomic
  rename. "Show diff vs git HEAD" reads the committed file (`git show HEAD:./<path>`, execFile, fixed arguments) and
  shows the line diff against the editor's content (unsaved edits included). The game requires exactly 3 variants:
  "+ Variant" / "− Variant" are allowed while editing (to replace one) but the validator refuses saving another count;
  moving a variant changes which building gets which layout (warned).
- **Sites**: painting a tile on open ground gives that cell tier 1 in the Tiers grid (and erasing clears it), so the two
  grids stay valid; change tiers on the Tiers grid (digits 1..max tier).
- **Interior art**: the room renderer's own tables (`PROP_TILE` -> `STRUCTURE_FURNITURE_ART`, `PROP_EXTRA`, the oriented
  `interiors-v2` pieces, the rug, `PROP_COLOR` stand-in blocks, `PROP_HEIGHT_PX`, `FLOOR_COLOR`, `WALL`), read from the
  text of client/src/interior.ts by `shared/interiorArt.ts` (they are module-private there; a test fails if the text
  drifts). Not reproduced: the 3/4 wall faces, the autumn-atlas stairs frame (its code-drawn stand-in is used), lighting.
  Level-gated symbols show a gold "2+" / "3+".
- API: `GET /api/interiors`, `GET /api/interiors/<id>`, `GET /api/interiors/<id>/head`, `POST /api/interiors/<id>/save`
  ({file, baseHash}); `POST /api/stamp` also takes `{kind: "sites", tier}` and `{kind: "pois", samples}`.

| Key (Area tab) | Action |
| --- | --- |
| P L R F I S B | Pencil, line, rectangle, fill, eyedropper, select, place building |
| Left / right drag | Paint the brush / erase to open ground (right-click a building: remove it) |
| Middle drag, Space + drag, wheel | Pan, pan, zoom |
| M, Shift+M | Mirror painting left-right, top-bottom (building tool: R / M turn / mirror the building) |
| Ctrl+C / X / V, Delete, Esc | Copy / cut / paste (then click) the selection, clear it, drop it |
| V | Stamp preview on / off |
| Ctrl+Z, Ctrl+Y, Ctrl+S, + - 0, G | Undo, redo, save, zoom, fit, grid |

## Validators v1 (`shared/validators.ts`)

Used by the Compare tab, `GET /api/validate/<set>` and the CLI:

```
npm run lab:validate -- grounded-v2 [more sets] [--root dir] [--json]   # exit 1 when any check FAILs
```

Checks: every part has a manifest entry and a PNG (orphan PNGs warn); naming rules; size matches the PNG and scale is
sane (and similar within a family); pivot inside the image (overlays hair / hairBack / helm may hang below, like the
game's neck anchor); transparent border; dark rim on the outer edge (game art ~25-45 luminance, rim colour #191414);
palette size (flat fills warn); no faint semi-transparent noise specks. Thresholds were tuned on grounded-v2
(`LIMITS` in the file).

## Saving, backups

- Save sends one transaction to the local server: manifest + changed PNGs + `lab.json` (+ PNGs no longer used, which are
  deleted). If `manifest.json` changed on disk since the set was loaded the save is refused (reload the set).
- The manifest is rewritten with `shared/manifest.ts`: untouched part entries, top-level keys and whitespace stay
  byte-for-byte, changed entries are written in the file's own indent, so `git diff` shows only what you edited.
  (The slicer's `--merge` rewrites the whole file with a 1-space indent; that is the slicer, not the Lab.)
- Every write is atomic (temp file in the same folder, then rename). Every file that is overwritten or deleted is first
  copied to `art-sources/lab/backups/<timestamp>/<same relative path>`; the newest 30 backup folders are kept
  (git-ignored). Import sheet backs up the whole set folder before the slicer runs and keeps the uploaded sheet in
  `art-sources/lab/sheets/`.

## Security model

- The server binds **127.0.0.1 only** and answers only to `Host: 127.0.0.1:<port>` / `localhost:<port>` (blocks DNS
  rebinding). It sends no CORS headers; requests with a foreign `Origin` or `Sec-Fetch-Site: cross-site` are refused.
  Writes (POST/PUT only) also need our own `Origin`, `X-Lab: 1` and `Content-Type: application/json`.
- Writable folders (allow-list, relative to the root): `client/public/rig/parts/<set>/` (set name
  `^[a-z0-9][a-z0-9_-]{0,40}$`; PNGs, `manifest.json`, `lab.json`, `slice-report.json` only),
  `client/public/rig/clips/<name>.json`, `art-sources/lab/`, and (Area tab) `server/data/{camps,buildings,settlements}/user/`
  (`^[a-z0-9][a-z0-9_-]{0,60}\.json$` only; the built-ins beside them never). Nothing else, ever (no saves, no live
  copy, no code).
- Paths are refused when they contain NUL, backslashes, `%` after one decode, `.`, `..` or empty segments, or are
  absolute; writes are refused if any existing component below the root is a symlink (or the target is one); reads
  must resolve inside the root. Bodies are size-limited (1 MB JSON, 24 MB for saves / sheets, 4 MB and 1024 px per PNG).
- The slicer runs as `node scripts/slice-rig-sheet.mjs` from this repo (never from the root copy) via `execFile`
  without a shell, with only validated arguments (known layout name, set name, `auto|none`, `--merge`).
- Read-only: `client/public/rig` and `client/public/sprites` of the root, the Piskel bundle, `client/src/heroRig.ts`,
  the template built-ins; the Area tab's Vite may serve `shared/src` and `client/src` of the repo (imports only).
- The real stamper runs `node --import tsx --import stamper/alias.mjs stamper/worker.ts` (repo tsx, cwd `server/`,
  no shell, a scratch COLONY_SAVE_DIR, COLONY_TEST_HOOKS=1, one at a time, 60 s timeout).

## Palette source of truth

Skin / hair ramps and the recolour formula live in `client/src/heroRig.ts` (`SKIN_COLORS`, `HAIR_COLORS`, `colored()`).
The server extracts them on each request (`server/palette.ts`); `shared/recolour.ts` mirrors only the shape of the
formula with every number taken from that extraction. There is no fallback copy: if the game's formula text changes,
the Lab shows "Recolour unavailable" and `test/validators.test.ts` fails, so the Lab is updated instead of drifting.

## Layout

```
tools/sprite-lab/
  server/   main.ts (CLI entry), lab.ts (HTTP + API), paths.ts (allow-list), store.ts (atomic writes, backups),
            sets.ts, palette.ts, png.ts, templates.ts (Area API), game.ts (loads shared/area.ts via tsx tsImport),
            stamp.ts + stamper/ (worker.ts, alias.mjs, alias-hooks.mjs: the real server stamper, headless)
  shared/   names.ts, manifest.ts (format-preserving writer), validators.ts, recolour.ts, clip.ts (clip format,
            validation, evaluation), pose.ts (pose solver), clipedit.ts (key / pose / mirror edits),
            area.ts (template kinds on the game's shared code), grid.ts (painting ops)   (Node + browser)
  app/      index.html, src/ main.ts (shell), project.ts (set model + undo), pixelview.ts, parts.ts, draw.ts,
            compare.ts, rigframe.ts (body.html bridge), png.ts (lossless browser PNG), api.ts, ui.ts, undo.ts,
            rig/ tab.ts (Rig tab), timeline.ts, render.ts (body.html placement on rig-core), export.ts, hook.ts,
            area/ tab.ts (Area tab), render.ts, art.ts (game tile-art tables), pixi-stub.ts
  cli/      validate.ts
  test/     server, manifest, validators, clip (format + maths), rig-golden (equivalence), smoke (headless browser)
  vendor/piskel/   Piskel source (Apache-2.0) + our bridge, see NOTICE.md
  piskel-dist/     built Piskel served at /piskel/
  scripts/build-piskel.mjs, scripts/make-builtin-clips.ts
```

Server API (JSON): `GET /api/info`, `GET|POST /api/sets`, `GET /api/sets/<set>`, `POST /api/sets/<set>/save`,
`GET /api/palettes`, `PUT /api/palettes/<name>`, `GET /api/clips`, `GET|PUT /api/clips/<name>` (validated; built-ins
refused), `POST /api/clips/<name>/delete`, `POST /api/exports` ({name, png} -> art-sources/lab/exports/), `GET /api/refs`,
`GET /api/layouts`, `POST /api/slice`, `GET /api/validate/<set>`. Static: `/rig/*`, `/sprites/*`, `/piskel/*`.
Area: `GET /api/templates/<kind>[?full=1]` (list), `GET /api/templates/<kind>/<builtin|user>/<id>` (template + hash +
errors), `POST /api/templates/<kind>/save` ({template, overwrite?, baseHash?}), `.../import` ({template}, never
overwrites), `.../duplicate` ({src, from, id, name?}), `.../delete` ({id}, user only), `.../validate` ({template}),
`POST /api/stamp` ({kind: camps|settlements|sites|pois, template, transform, seed, tier?, samples?}: the real stamper);
stage B: kinds `sites`, `pois`, `castle-ruins` on the same routes, interiors on `/api/interiors` (see "Area tab").

## Tests

```
npm run lab:test          # all: server, manifest round trips, validators, clips, golden equivalence, browser smoke
node --test tools/sprite-lab/test/server.test.ts    # one file
npx tsc --noEmit -p tools/sprite-lab                 # type check
```

Every test works on scratch copies (`mkdtemp` + copy of `client/public/rig`, LAB_ROOT; the Area tests also copy
`server/data/{camps,buildings,settlements,sites,pois,castle-ruins}`, `shared/src/data/interiors` and part of
`client/public/sprites`) on ports 31800-31899 and never touches the repo. Area: `area-server` (API, allow-list,
refusals, backups, every built-in round trip), `area-grid` (grid ops vs the game's functions, anchors, placement /
collision, previews), `area-game` (the game's own template stores load Lab-saved files and write the same bytes, stage B
stores too; real stamper = shared-code preview; real stamper for sites / POI pools), `area-data` (stage B API +
allow-list incl. the interiors special case, refusals with the validators' reasons, 409, backups, byte-identical round
trips of every built-in site / POI / castle / interior file, interior grid ops, the hall invariant, interior preview =
`buildInteriorMap` for every file x layout x level, the art tables, diff vs HEAD), `area-smoke` and `area-data-smoke`
(headless browser). The smoke test needs Playwright and Chromium: by default the module from
`/home/james/projects/auto-loan-ff-release/package.json` and the Chromium in this session's scratchpad; override with
`LAB_PLAYWRIGHT_PKG`, `LAB_CHROME`; screenshots go to `LAB_SHOTS` (default the scratchpad `lab-shots/`).

## Rebuilding the Draw editor

```
node tools/sprite-lab/scripts/build-piskel.mjs [--work <new empty folder>]
```

Copies `vendor/piskel/` to a scratch folder, `npm ci --ignore-scripts` there (needs network), runs Piskel's sprite script
and `vite build`, then copies the output to `piskel-dist/` without source maps and the unminified bundle (~770 KB).
Commit `vendor/piskel` changes and `piskel-dist/` together and list every change in `NOTICE.md`.

## Licence notes

Piskel is Apache-2.0 (`vendor/piskel/LICENSE`); our modifications are listed in `NOTICE.md`. The Piskel name and logo are
not used as this tool's name. The rest of the Lab is part of this repo.

## Limitations (this round)

- The assembled preview and Compare use the SAVED files (they render `rig/body.html`, which loads from disk): save to
  see an edit there. body.html draws the walk / attack cycle with the harvested sword / helm / shield; sets without the
  parts body.html expects (e.g. `torso`, `head`, `pelvis`) show an error there.
- Draw sends back one frame (the current one); multi-frame animations made in Piskel are not stored as parts.
- No soft brush, no tablet pressure.
- Rig: side view of the human player only; no bending-limb meshes; the game runtime does not read clips yet (see above).
  One clip plays at a time (body.html's `walkattack` = walk + sword attack layered is not a clip). The Rig tab and
  Compare render the SAVED part files. axe / spear / bow follow index.html's angles but sit on grounded-v2's shorter
  bones, so the spear's off hand cannot always reach the grip 30 px up the shaft and the bow string hand stops ~6.5 px
  short of the shoulder (`Rig.ik2` clamps; the canvas marks the unreachable target in red).
- body.html's walk (and so the built-in `walk`) on grounded-v2's bones: the stance foot is on the ground for ~75% of the
  stance; at the stride ends the leg is too short for the target and the foot hovers up to 3.4 px. The canvas shows it
  (orange outline instead of the green planted bar). Fix it in a duplicate (shorter stride, lower hips) or in the parts.
- Import PNG through a non-PNG file goes through a canvas (fine for opaque art; PNGs are decoded losslessly).
- The draw order in `lab.json` is the Lab's own; the game and body.html still use their hard-coded order.
- Area stage B: user sites / POI pools / castle ruins are saved and load in the game's stores but world-gen does not use
  them yet (see "Area tab"); the Castle Ruin preview is shared-code only; the POI preview runs the `ruin` path of
  `placePoiSite` (the game stamps a camp template for `encampment`); interiors are saved into the game's built-in files
  (restart the server, rebuild the client) and must keep exactly 3 variants; a new building TYPE needs game code. The
  real stamper uses the repo's built-in templates (not a `--root` copy's) and saved user buildings (not unsaved edits).
  Tiles are drawn one sprite per cell (no autotiling). A user template whose file name differs from its id is listed
  and opened by file name; saving writes `<id>.json` (a rename leaves the old file: delete it). The game loads user
  templates at boot: restart the game server to see a Lab save in game.
