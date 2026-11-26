# Sprite Lab

A local web app for The Sworn Game's sprite parts: slice and edit part sets, set pivots and bone lengths, recolour with
the game's own ramps, draw with an embedded pixel editor, and compare the assembled body with real game art.
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
- **Rig (coming next)**, **Area (coming next)**: placeholders for the next rounds.
- **Compare**: set + look (pose, helm, shield, hair, time) of the assembled body beside any reference sprite from
  `client/public/sprites/` at the in-game size, 1x/2x/4x, with a height ruler (game pixels) and grid, and the
  validators v1 report for the set.

## Shortcuts

| Key | Action |
| --- | --- |
| Ctrl+S | Save the set |
| Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y | Undo / redo (Parts; inside Draw, Piskel's own undo) |
| + / - / 0 | Zoom in / out / fit (Parts view) |
| G | Grid on/off |
| Up / Down arrows | Previous / next part |
| Alt+1 ... Alt+5 | Switch tab |
| Mouse wheel | Zoom at the cursor; drag empty space (or middle / right button) to pan |

The orange dot in the header means unsaved changes (the browser also warns before leaving).

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
  `client/public/rig/clips/<name>.json`, `art-sources/lab/`. Nothing else, ever (no saves, no live copy, no code).
- Paths are refused when they contain NUL, backslashes, `%` after one decode, `.`, `..` or empty segments, or are
  absolute; writes are refused if any existing component below the root is a symlink (or the target is one); reads
  must resolve inside the root. Bodies are size-limited (1 MB JSON, 24 MB for saves / sheets, 4 MB and 1024 px per PNG).
- The slicer runs as `node scripts/slice-rig-sheet.mjs` from this repo (never from the root copy) via `execFile`
  without a shell, with only validated arguments (known layout name, set name, `auto|none`, `--merge`).
- Read-only: `client/public/rig` and `client/public/sprites` of the root, the Piskel bundle, `client/src/heroRig.ts`.

## Palette source of truth

Skin / hair ramps and the recolour formula live in `client/src/heroRig.ts` (`SKIN_COLORS`, `HAIR_COLORS`, `colored()`).
The server extracts them on each request (`server/palette.ts`); `shared/recolour.ts` mirrors only the shape of the
formula with every number taken from that extraction. There is no fallback copy: if the game's formula text changes,
the Lab shows "Recolour unavailable" and `test/validators.test.ts` fails, so the Lab is updated instead of drifting.

## Layout

```
tools/sprite-lab/
  server/   main.ts (CLI entry), lab.ts (HTTP + API), paths.ts (allow-list), store.ts (atomic writes, backups),
            sets.ts, palette.ts, png.ts
  shared/   names.ts, manifest.ts (format-preserving writer), validators.ts, recolour.ts   (Node + browser)
  app/      index.html, src/ main.ts (shell), project.ts (set model + undo), pixelview.ts, parts.ts, draw.ts,
            compare.ts, rigframe.ts (body.html bridge), png.ts (lossless browser PNG), api.ts, ui.ts, undo.ts
  cli/      validate.ts
  test/     server, manifest, validators, smoke (headless browser) tests
  vendor/piskel/   Piskel source (Apache-2.0) + our bridge, see NOTICE.md
  piskel-dist/     built Piskel served at /piskel/
  scripts/build-piskel.mjs
```

Server API (JSON): `GET /api/info`, `GET|POST /api/sets`, `GET /api/sets/<set>`, `POST /api/sets/<set>/save`,
`GET /api/palettes`, `PUT /api/palettes/<name>`, `GET /api/clips`, `GET|PUT /api/clips/<name>`, `GET /api/refs`,
`GET /api/layouts`, `POST /api/slice`, `GET /api/validate/<set>`. Static: `/rig/*`, `/sprites/*`, `/piskel/*`.

## Tests

```
npm run lab:test          # all: server, manifest round trips, validators, browser smoke (about 30 s)
node --test tools/sprite-lab/test/server.test.ts    # one file
npx tsc --noEmit -p tools/sprite-lab                 # type check
```

Every test works on scratch copies (`mkdtemp` + copy of `client/public/rig`, LAB_ROOT) on ports 31800-31899 and never
touches the repo. The smoke test needs Playwright and Chromium: by default the module from
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
- Rotated "far side" parts and per-pose previews are the Rig tab's job (next round). No soft brush, no tablet pressure.
- Import PNG through a non-PNG file goes through a canvas (fine for opaque art; PNGs are decoded losslessly).
- The draw order in `lab.json` is the Lab's own; the game and body.html still use their hard-coded order.
