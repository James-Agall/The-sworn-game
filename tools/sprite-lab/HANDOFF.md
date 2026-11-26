# Sprite Lab: handoff (2026-11-26)

## Round 3: Rig tab (in progress, newest last)
- DONE (commit "Rig: clip format..."): `shared/clip.ts` (format `sworn-clip/1`, strict validator, rig-core-based evaluation:
  keys with eases, loop wrap, waves, gait), `shared/pose.ts` (body.html skeleton() as a solver + FK/IK modes),
  `client/public/rig/skeletons/human.json`, built-in clips in `client/public/rig/clips/` (generator
  `scripts/make-builtin-clips.ts`), server: clip PUT validates + refuses built-ins, `POST /api/clips/<n>/delete`,
  `POST /api/exports` (art-sources/lab/exports/<name>.png), `app/src/rig/render.ts` (body.html build/drawFrame mirror,
  loads /rig/rig-core.js), `app/src/rig/hook.ts` (window.__labRig), tests `clip.test.ts`, `rig-golden.test.ts`
  (idle / walk / sword: 0 px differ vs body.html; axe / spear / bow: 504 channel checks vs index.html, worst 1e-13 deg).
- NEXT: Rig tab UI (`app/src/rig/tab.ts`, timeline), export contact sheet / bake, smoke test, docs, MANUAL-TESTS.

## Progress (round 2, newest last)
- Steps 1-7 DONE (see README.md for the user-facing description, NOTICE.md for Piskel).
  - Server + validators + CLI + tests (159f14c); pristine Piskel (d818db5); app + tabs (5686220); bridge + piskel-dist
    (c90d838); smoke test (23c25a5); docs + MANUAL-TESTS (this commit).
  - `npm run lab:test`: server, manifest, validators and the headless smoke test all pass.
- Decisions made this round: browser PNG codec (`app/src/png.ts`) so pixels never pass through a canvas; the Piskel bridge
  moves raw RGBA (not PNG data URLs); hair / hairBack / helm are "overlay" families whose pivot may lie outside the image
  (they hang on the head's neck point); torso / head / pelvis / hair / helm bones point UP (`boneDir` in shared/names.ts).
- Next rounds: Rig tab, Area tab (see the final report / README limitations).

(Original round-1 notes follow.)


Spec: `/home/james/docs/colony2d/SPEC-sprite-lab.md`. This round's brief covered spec stages 2 and 3 plus a basic Compare tab.
Worktree: `/home/james/projects/the-sworn-game-lab`, branch `sprite-lab` (off `integration-test` 89abd3e). Never commit the
`node_modules` / `client/node_modules` symlinks.

## What exists (committed)
- `shared/names.ts`: name rules. Set `^[a-z0-9][a-z0-9_-]{0,40}$`, part keys, PNG file names, palette/clip names,
  `NON_PART_PNGS` (slice-preview.png, parts-sheet.png), sidecar name `lab.json`, `variantOf` / `familyOf`.
- `shared/manifest.ts`: manifest types, `deepEqual` (key order matters), a small JSON span scanner, and
  `writeManifestText(oldText, next)`. It copies every untouched part entry, top-level key and the whitespace between them
  byte-for-byte, and writes changed or new entries in the file's own indent. `checkManifestShape()` validates a manifest
  sent by a client. NOT TESTED YET.
- `tsconfig.json`: `npx tsc --noEmit -p tools/sprite-lab` passes (it checks only the two files above so far).

## Not started
Server, app shell, Parts tab, Draw tab, Compare tab, validators, CLI, tests, README, MANUAL-TESTS section, root package.json
scripts, `package.json` for the Lab.

## Findings so far (no need to work these out again)
- Node 22.23 strips TypeScript types by default: `node file.ts` runs with `.ts` import specifiers and no warning. So the
  server, CLI and tests can be `.ts` files run directly (erasable syntax only: no enums, no parameter properties). Tests: `node --test`.
- The root `node_modules` (a symlink to the main checkout) has vite 6.4.4, typescript 5.9.3 and @types/node. The Lab can use
  them without new dependencies. Do NOT `npm install` (it would change the shared node_modules). If Vite runs in middleware
  mode, set `cacheDir` to `tools/sprite-lab/.vite-cache` (gitignore it) and set `server.fs.allow` to the app dir only.
- Manifest formats differ between sets. grounded-v2 uses a 2-space indent and is exactly `JSON.stringify(m,null,2)`.
  painted-v1, bodyset, placeholder and sliced-demo use a 1-space indent. Some files end without a newline. The slicer writes
  `JSON.stringify(m,null,1)`, so a slicer `--merge` reformats a 2-space file (document this; it is not a Lab bug).
- Manifests have no z-order field (body.html and heroRig.ts hard-code the draw order). Plan: keep the Lab's draw order in a
  sidecar `client/public/rig/parts/<set>/lab.json`.
- The "joint" in the manifest is a NAME string ("shoulder", "root / hips"), not a point. The plan for the joint handle: it is
  the bone end at (pivot.x, pivot.y + len), like the yellow line in parts-sheet.html. Dragging it sets `len`.
- Palette source of truth: `client/src/heroRig.ts` `SKIN_COLORS` (5) and `HAIR_COLORS` (6). The recolour in `colored()` is:
  skin = px * skin / [224,173,124]; hair = hairColour * luminance / 115; far-side limbs x0.78. The plan: the server
  regex-extracts the arrays and constants from the file, with no fallback (show an error if the extraction fails), plus a test
  that fails if the formula text drifts. No client code changes this round.
- body.html: `?parts=<set>`. It fetches `parts/<set>/manifest.json` plus `../sprites/autumn/frames/heroes/base-05.png` and
  `champion-01.png` (both are 155x128). It is same-origin, so `iframe.contentWindow.__rig.freeze = t` and
  `__rig.sheet({frames:[{cfg:{state,helm,shield,hair},t}],cols:1,scale:1})` return a PNG data URL. The frame sits at
  (6,22) with size 256x176. Use this for the Compare tab still, so the Lab does not copy the rig code. The game scale is 0.255
  (98 px source body -> 25 px).
- Slicer: `node scripts/slice-rig-sheet.mjs <sheet> <layout> --out <dir> [--bg auto|none] [--merge] [--dry]`. It writes
  `<cell>.png`, the `default` aliases, manifest.json, slice-report.json and slice-preview.png directly, with no atomic write and
  no backup. The Lab must back up those files before it runs the slicer. Run it with execFile and no shell. Run the repo's own
  script, not one from LAB_ROOT. `scripts/lib/png.mjs` (decodePNG/encodePNG, no deps) can be reused for validators and PNG checks.
- `tools/sprite-making/validate.mjs` already has rim / soft-edge / stray heuristics (rim luminance < 60, richness > 60
  colours per 1000 px). Use them as a start for validators v1 and tune them on grounded-v2.

## Piskel (not vendored yet; a scratch clone exists)
- Upstream: github.com/piskelapp/piskel, Apache-2.0. Pin commit `eda45430e9f5a1d61d3ac4c965f25b6b705b0e6f` (2026-11-26).
- Scratch clone: `/tmp/claude-1000/-home-james/e750a2dc-86fa-43ba-992d-dfa7a0e3a701/scratchpad/lab-piskel/src`. A test build
  in `.../lab-piskel/build1` WORKED with `npm ci --ignore-scripts`, then `node scripts/sprite.js`, then
  `./node_modules/.bin/vite build`. The output is `dest/prod`, 6.5 MB in total, but most of that is source maps and the
  unminified JS. index.html loads only `js/piskel-packaged-min-<ver>.js` (489 KB) plus css/img. Without the maps and the
  unminified JS the bundle is about 1.3 MB, so it can be committed (well under 15 MB).
- What to vendor into `vendor/piskel/`: LICENSE, README.md, package.json, package-lock.json, tsconfig.json, biome.jsonc,
  vite.config.js, vite-plugins/, scripts/, src/. Skip tests/ (3.1 MB), misc/ (6.3 MB), docs/ and bin/. Commit the pristine
  copy first, then the modifications, so the diff is visible.
- Bridge plan: add a new file `src/js/lab-bridge.ts` and one line `import "./lab-bridge";` in `src/js/main.ts`, and list both
  in NOTICE.md. It imports `app`, `Piskel`, `Layer`, `Frame`, `FrameUtils` and `Descriptor` directly.
  - On `message`, check `origin === location.origin` and `source === parent`.
  - `lab:open {png, w, h, name, referencePng?}` builds a Piskel with layer "Part" and an optional "Reference" layer
    (`setOpacity(0.35)`). It must use `FrameUtils.createFromImage(img, true)` (preserveOpacity, because the art is painted with
    soft alpha), then call `app.piskelController.setPiskel(piskel)`.
  - `lab:get` returns the merged frame without the reference layer. Build that PNG from `frame.pixels` (Uint32, RGBA bytes)
    straight into ImageData so it is lossless. Do not use FrameUtils.toImage.
  - `lab:set-preview` uses `UserSettings.set(UserSettings.PREVIEW_SIZE, "original"|"best"|"full")`.
  - Send a debounced `lab:changed` on PISKEL_SAVE_STATE / HISTORY_STATE_LOADED.
  - Watch BeforeUnloadService (it can block a reload in tests).
- Tab title: "Draw (based on Piskel)". Do not use the Piskel name or logo for the product.

## Next steps, in order
1. `tools/sprite-lab/package.json` (private, type module, no deps). Add these root package.json scripts (additive only):
   `lab` = `node tools/sprite-lab/server/main.ts`, `lab:test` = `node --test tools/sprite-lab/test/`,
   `lab:validate` = `node tools/sprite-lab/cli/validate.ts`. Add `art-sources/lab/backups/` and `tools/sprite-lab/.vite-cache/`
   to .gitignore.
2. Server (`server/`), on 127.0.0.1 only, PORT default 5180, with `--root`/LAB_ROOT.
   - Security: check Host is 127.0.0.1/localhost:port. Writes need an Origin equal to our own origin, `X-Lab: 1` and a JSON
     or PNG content type. Refuse a foreign Origin or `Sec-Fetch-Site: cross-site`. Send no CORS headers.
   - Safe path resolve: refuse NUL, backslash, absolute paths, `.`/`..`/empty segments and any `%` left after one decode.
     Check that the realpath of the parent is still inside the allow-list. Refuse symlinked targets (lstat).
   - Writes are atomic (temp file in the same dir, then rename). Back up to `art-sources/lab/backups/<timestamp>/<relpath>`
     and keep the newest 30. Limit body sizes.
   - API: sets list/create; manifest GET, which returns the text sha256; save transaction POST
     `{manifest, sidecar, files:{name:b64}, deleteFiles, baseHash}`, which answers 409 if the hash is stale; palettes (heroRig
     extraction is read-only, plus art-sources/lab/palettes/*.json); clips GET/PUT; reference sprites listing under
     `client/public/sprites/`; layouts listing; slice (store the sheet in art-sources/lab/sheets/, back up, execFile the
     slicer); validate.
   - Static: client/public read-only (/rig, /sprites); /piskel from piskel-dist; the app through Vite middleware.
3. Tests for step 2 and for manifest round trips: an untouched manifest gives identical bytes on all 5 real sets, and a
   one-part edit changes only that entry.
4. Validators (`shared/validators.ts`) and the CLI, using the checks listed in the brief. Tune them on grounded-v2.
5. App shell: tabs, a shared PixelView (zoom 1-16x, pan, grid, handles), an undo service, the project model and a dirty
   indicator. Then the Parts tab, then Compare.
6. Vendor Piskel, add the bridge, build script `scripts/build-piskel.mjs`, commit `piskel-dist/`, then the Draw tab and the
   game-size strip.
7. Playwright smoke test (paths are in the original brief), screenshots in the scratchpad `lab-shots/`, README, NOTICE.md,
   MANUAL-TESTS.md section. Run tsc for shared/server/client and `npm run smoke` once.
