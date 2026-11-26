# Third-party notice: Piskel

The Sprite Lab's Draw tab embeds a modified copy of **Piskel**, a pixel-art editor.

- Upstream: https://github.com/piskelapp/piskel
- Copyright: Julian Descottes and the Piskel contributors (see `vendor/piskel/package.json` and the upstream history)
- Licence: Apache License 2.0, full text in `vendor/piskel/LICENSE`. The upstream repository ships no NOTICE file.
- Pinned upstream commit: `eda45430e9f5a1d61d3ac4c965f25b6b705b0e6f` (2026-11-26), recorded in `vendor/piskel/UPSTREAM_COMMIT`.

"Piskel" is the upstream project's name. The Apache licence grants no trademark rights, so the Lab does not use the
Piskel name or logo as its own name: the tab is called "Draw (based on Piskel)". Piskel's own interface inside the
iframe is left as upstream made it.

## What was copied

`vendor/piskel/` holds the upstream files `LICENSE`, `README.md`, `package.json`, `package-lock.json`, `tsconfig.json`,
`biome.jsonc`, `vite.config.js` and the folders `vite-plugins/`, `scripts/`, `src/`, unmodified except as listed below.
Not copied: `tests/`, `misc/`, `docs/`, `bin/`, `TODO`, `playwright.config.ts`, `run-test-ci.sh`, `vitest.config.mjs`.
The pristine copy is its own commit ("vendor Piskel ... pristine"), so `git diff` against it shows every change.

## Modifications (Apache-2.0 section 4(b): modified files carry a notice)

1. **Added** `vendor/piskel/src/js/lab-bridge.ts` (new file, written for the Sprite Lab; its header says so). A
   postMessage bridge for a same-origin parent page: `lab:open` (load a part's RGBA pixels, optional 35 % "Reference"
   layer), `lab:get` (return the current frame of all non-reference layers as raw RGBA), `lab:set-preview` (Piskel's
   preview size setting), and the events `lab:ready` / `lab:changed`. It only accepts messages from `window.parent` with
   the page's own origin and is inactive when Piskel is not inside an iframe.
2. **Changed** `vendor/piskel/src/js/main.ts`: one added line, `import "./lab-bridge";` (after `import "./bridge";`).
3. **Added** `vendor/piskel/UPSTREAM_COMMIT` (the pinned commit hash).

## Built bundle

`piskel-dist/` is the output of Piskel's own build (`node scripts/sprite.js` + `vite build`) of the modified source above,
made by `scripts/build-piskel.mjs` in a scratch copy. Compared with upstream's `dest/prod` it leaves out the source maps,
the unminified bundle and the piskelapp.com partials, and strips the `sourceMappingURL` comment from the minified
bundle. Nothing else in the output is changed. Rebuild: `node tools/sprite-lab/scripts/build-piskel.mjs` (needs network
for `npm ci --ignore-scripts`; see README.md).
