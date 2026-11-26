# Splitting `client/src/main.ts` (2026-11-26)

Branch `main-split` (off `integration-test` 89abd3e). Pure refactor: no behaviour, DOM, protocol, rendering or
performance change. This file is the plan written before the first extraction; the "Result" section at the end is
filled in as seams land.

## 0. Shape of the file before the split

- 9,081 lines, 466 KB. 94 import declarations, two module-level values (`SERVER_URL`, `adventurePrefs`).
- ONE `async function main()` (lines 245-9056) holding 1,067 top-level statements: ~285 function declarations,
  ~500 `const`/`let` declarations (DOM element refs, Pixi layers, caches, per-feature state), ~120 side-effecting
  statements (event listeners, `app.ticker.add`, DOM tweaks), 16 local `interface`/`type` declarations.
- Only three `await`s, all at the start (app init, required textures, optional art). Everything after them runs
  synchronously to the end of `main()`, so no event listener, ticker or socket callback can run before every
  statement of `main()` has executed. That makes moving function declarations safe as long as nothing executed
  during init (outside a callback) calls them before their factory has been created.
- After `main()`: `setupMainMenu(...)` and ~25 lines of HUD layout code (control strip / colony header / stockpile).

## 1. Method

Tooling (kept outside the repo, scratchpad `tools/`): a TypeScript-checker based analyser that lists `main()`'s
top-level statements and, for any set of line ranges, the closure variables the range uses (with kind, whether they
are ever reassigned anywhere, read/write counts in the range) and the names declared in the range that the rest of
`main()` uses. A codemod uses the same data to move a range into a module:

```ts
// client/src/game/<seam>.ts
export interface <Seam>Context { stableDep: Type; readonly liveDep: Type; settableDep: Type; }
export function create<Seam>(game: <Seam>Context) {
  const { stableDep, ... } = game;          // fixed references, read once
  ... the moved statements, verbatim; a live dep is read as game.liveDep ...
  return { exportedFn, ..., get liveExport() { return liveExport; } };
}
// main.ts, at the position of the first moved statement (so ticker/listener registration order is unchanged):
const { exportedFn, ... } = create<Seam>({ stableDep, get liveDep() { return liveDep; }, ... });
```

Rules:
- STABLE deps: function declarations, `const`s and never-reassigned `let`s declared before the creation point. They
  are destructured once inside the factory, so the moved code reads them exactly as before (same call shape, no
  extra per-frame work).
- LIVE deps: `let`s reassigned anywhere in `main()` (`tiles`, `tileSize`, `myId`, `camZoom`, `latest*`, ...), or
  anything declared after the creation point. They are read through a getter on the context (`game.tiles`), and
  written through a setter when the seam assigns them. No closure state becomes a module-level global.
- Shared mutable state (a `let` written from several features, e.g. `latestColonists`, `selectedIds`) stays
  declared in `main.ts` (`--keep`); seams see it through getters. A `let` written only by its seam moves with it and
  `main.ts` reads it through the returned API's getter.
- Local types move to `client/src/game/types.ts` first (commit 1), so modules can import them.
- Creation call at the original position of the seam's first statement; seams whose non-function statements are not
  contiguous are not merged (order of `app.ticker.add` / `addEventListener` calls must not change).
- After each extraction: `tsc` x3, vite build to a scratch dir, `client/split-smoke.mjs` against the baseline,
  `npm test -- render-depth character-sheet`; one commit per seam.

## 2. Seams and their closure dependencies (line numbers of main.ts after the types commit)

Counts from the analyser. "live" = read through a getter (rw = also written). "exports" = what main.ts still needs.

| # | Seam | Lines | Module / factory | Stable deps | Live deps | Exports (live) | Notes |
|---|------|-------|------------------|-------------|-----------|----------------|-------|
| 1 | Local types | 16 decls | `game/types.ts` | - | - | 16 types | type-only, zero runtime change |
| 2 | End-of-file HUD layout | last ~25 lines (top level, after main) | `game/hudLayout.ts` `setupHudLayout()` | none | none | none | runs after `setupMainMenu`, order kept |
| 3 | Save panel | 7247-7312 | `game/savePanel.ts` | sendMessage, creativeUi | - | renderSavePanel | leaf |
| 4 | Game over / heir picker / builders line | 5864-5905 | `game/gameOver.ts` | sendMessage, creativeUi | - | refreshGameOver, refreshBuilderCount, statRespawnEl | leaf |
| 5 | HUD status rows (paused banner, weather overlay, calendar, food, winter, raid forecast, agri) | 4261-4393 | `game/hudStatus.ts` | app, applySeason, pushEventToast | - | 8 | leaf |
| 6 | Sound + upgrade FX triggers | 4823-4982 | `game/soundHooks.ts` | tileCenter, spawnFxAnim | soundSuppressed (rw), tileSize, myId, worldTilesX/Y, tiles | 6 | snapshot-rate, not per frame |
| 7 | Fight arrows / pings / peek | 4077-4255 | `game/fightArrows.ts` | currentInput, app, worldLayer, playerSprites, strategyCam, pushEventToast | tileSize, camZoom, myId | 6 (+ fightPeek, fightPeekCam rw, latestFights) | one ticker; keep fightPeek* in main (written by strategy) |
| 8 | Minimap | 3614-4069 | `game/minimap.ts` | strategyCam, chunkOfTile, strategicMapSprite, worldLayer, app, colour tables, drawFightPings | 18 (world arrays/sizes, sites, clans, latest*) | 7 (+ strategicMapDirty rw, explored, minimapCssPerTile) | paint loops read `game.tiles` (getter) |
| 9 | Hero sheet / inventory / tooltips | 6083-6651 | `game/heroSheet.ts` | sendMessage, renderSpellBar, heroToolsRef | latestColonists, selectedIds, spellCdAt (rw) | 7 (+ heroProfile) | DOM only |
| 10 | Spell bar + aiming | 6658-6778 | `game/spellBar.ts` | 9 | heroProfile, latestMobs, latestColonists, myId | 4 (+ spellAim, spellCdAt, latestPlayersForSpells kept in main) | one ticker |
| 11 | Toasts / settlement panel / goal tracker / boss + player bars | 6041-6076, 6783-6929 | `game/hudPanels.ts` | 7 | myId, tileSize | pushEventToast, ... | pushEventToast used early only inside callbacks |
| 12 | Building info panel + trade / vassal / work posts + quest / work / chronicle panels | 4986-5861 | `game/buildingPanel.ts` | sendMessage, strategyCam, pushEventToast, worldLayer, app, interiorRef | selectedIds, fightPeek (rw), tileSize, + 2 train buttons | 10 (+ latestQuests, infoTile, questCycleTicks, questSeen) | 851 lines; latestQuests kept in main |
| 13 | Time controls | 5974-6031 | `game/timeControls.ts` | 9 | 5 | syncTimeControls (+ currentPaused) | |
| 14 | Strategy view / regiments / orders / banners / intel | 7436-7682, 7868-8318 | `game/strategyView.ts` | 32 | 21 | 27 (+ 6 live) | two ranges, first has no ticker; second only functions + 2 listeners |
| 15 | Selection / formation markers | 4561-4819 | `game/selection.ts` | 13 | 5 | 15 | latest* and selectedIds kept in main |
| 16 | Toolbar / build menu / progression | 4417-4557 | `game/toolbar.ts` | 15 | socket, camZoom, selectedIds | 9 (+ currentTool etc.) | `sendMessage` lives here today; keep sendMessage in main |
| 17 | Keyboard input | 7315-7429 | `game/keyboard.ts` | 21 | 7 | currentInput | listener order kept (one creation point) |
| 18 | Adventure HUD / hero tools / interior / combat wiring | 7688-7865 | `game/adventureHud.ts` | 42 | 14 | adventurePartyKey | many deps; do late |
| 19 | Pointer input (canvas down/up/move/wheel, minimap drag, demolish confirm) | 8321-8999 | `game/pointerInput.ts` | 57 | 28 | lineGuide, cancelLeftPress, cancelOrderPress | heavily state-shared; do last of the UI |
| 20 | Render core: texture loading (has `await`s), anim sets, tile sprites + autotiling, critters / wildlife, unit upserts, FX, chunk streaming | 250-3610 | several `game/render*.ts` | many | tileSize, worldTilesX/Y, tiles, camZoom, myId, ... | many | hot paths; only if the getter cost is shown to be nil |
| 21 | Socket message handler | 6932-7244 | stays in main.ts | - | - | - | the hub: writes most `let` state |

## 3. Extraction order

Leaves first (few deps, nothing else depends on their internals): 1 types, 2 layout, 3 save panel, 4 game over,
5 HUD status, 6 sound, 7 fight arrows, 8 minimap, 9 hero sheet, 10 spell bar, 11 HUD panels, 12 building panel,
13 time controls, then the shared-state UI: 14 strategy, 15 selection, 16 toolbar, 17 keyboard, 18 adventure HUD,
19 pointer input, then render-core pieces (20) one at a time while main.ts is still over target. The socket message
handler (21) and the core state declarations stay in main.ts.

## 4. Risks and how they are handled

- TDZ: a function moved into a factory is no longer hoisted. Any call during `main()`'s synchronous init that runs
  before the factory call would throw. The codemod lists every use located before the creation point; the smoke run
  catches the rest (page errors must stay empty).
- Reassigned `let`s copied by value would freeze: the codemod never copies a reassigned `let`; it uses getters.
- Init order: the factory call sits where the seam's first statement was; non-function statements of one seam must
  be contiguous, so `app.ticker.add` and listener registration order is unchanged.
- Hot paths: stable deps are plain locals in the module (same as the closure); only live `let`s cost a getter call,
  which V8 inlines for these monomorphic object literals. Render-core seams (20) are the only per-frame ones and go
  last; the `?perf=1` overlay and bundle size are compared at the end.
- Behaviour drift from text edits: the codemod moves statement text verbatim; the only edits are `name` ->
  `game.name` for live deps (by symbol resolution, not regex) and `name` -> `<api>.name` in main for live exports.

## 5. Regression net

`client/split-smoke.mjs` (see its header). Builds the client with `VITE_SERVER_URL` set to a private port, boots a
private server (scratch `COLONY_SAVE_DIR`, `COLONY_TEST_HOOKS=1`, world 160, seed 42), serves the build, starts a
Creative game, freezes the world on its first snapshot (so the scene is identical run to run), then walks 23 steps:
HUD + minimap present, inventory sheet (` key, tab, Escape, close button), strategy view (Tab) on/off, Quests /
Work / Chronicle panels open/close, Town Center interior enter/leave (test hook + `interiorExit`), carry 5 wood and
drop one through the inventory drop button (ground stack checked via the `groundItems` hook), wheel zoom in/out,
canvas context menu suppressed, `[`/`]` keys, pause button off/on, place a Cottage through the build menu (world
running for that step). Each step records a DOM/state dump, the message types the client sent, and a screenshot.
With `--baseline <dir>` it compares console errors, page errors, failed requests, received message types, dumps,
sent messages, and screenshots (pixel diff; 0.5% tolerance while frozen, 3% once the world runs).

Baseline noise (two runs of the unmodified build): 0.00-0.03% on frozen steps (0.26% on the interior step: the
interior NPCs), 0.47-0.89% on the running steps. Baseline errors: one console error ("Failed to load resource: 404")
and six failed requests: `ruinedKeep.png`, `siteKeep.png`, `siteTent.png` (404 + aborted each): known missing
optional sprites.

## 6. Result (stopped early on 2026-11-26: usage limit)

Status: PARTIAL. `main.ts` went from 9,081 lines to 6,065. The target was under ~1,500. Work stopped because usage
ran out, not because the code was too tangled to move.

Commits on `main-split` (one seam each). Every commit passed tsc on shared, server and client. Every extraction
commit also passed `client/split-smoke.mjs` against the baseline (no checklist failures, no page errors, the same
console error and failed-request lists, pixel diffs inside tolerance):

| Commit | Module | Lines |
|--------|--------|-------|
| 05678b4 | `game/types.ts` (types only; the bundle is byte-identical) + split-smoke + this plan | 125 |
| 5599eb1 | `game/hudLayout.ts` | 27 |
| 91e2425 | `game/savePanel.ts` | 80 |
| b05e2d5 | `game/gameOver.ts` (+ split-smoke tolerances for noise measured between two baseline runs) | 59 |
| c78eeb7 | `game/hudStatus.ts` | 159 |
| f73c500 | `game/soundHooks.ts` | 181 |
| e066f87 | `game/fightArrows.ts` | 202 |
| a5e4e77 | `game/minimap.ts` | 496 |
| 7218405 | `game/heroSheet.ts` | 592 |
| c758ae8 | `game/spellBar.ts` | 162 |
| 9fa964e | `game/hudPanels.ts` | 195 |
| 7ec4750 | `game/timeControls.ts` | 90 |
| a9a9275 | `game/buildingPanel.ts` | 915 |

Main bundle chunk: 974,739 bytes before, 983,323 after a9a9275 (+0.9%: the getter objects and the destructuring).
The `?perf=1` comparison was NOT done.

Shared `let` state kept in main.ts on purpose, because the message handler or another feature writes it:
`fightPeek`, `fightPeekCam`, `strategicMapDirty`, `spellCdAt`, `latestPlayersForSpells`, `lastGoalIndex`,
`latestQuests`, `questCycleTicks`, `questSeen`.

Remaining, in the recommended order (re-run the analyser first, because line numbers have moved):
1. Strategy view (seam 14), then selection (15), toolbar (16), keyboard (17), adventure HUD (18), pointer input (19).
   Keep `latestColonists`, `latestMobs`, `latestTaskForces`, `selectedIds`, `currentTool` and `panDrag` in main.
2. Render core (20): texture loading (contains `await`s, so it needs an async factory), anim sets, tile sprites,
   critters and wildlife, unit upserts, FX, chunk streaming. These are per-frame paths, so measure `?perf=1` before
   and after.
3. The socket message handler (21) stays in main.ts.

Notes for the next agent:
- The codemod tooling lives in the old session's scratchpad `tools/` (analyze.mjs, extract.mjs, prune.mjs, seam.sh).
  It is not in the repo and may be gone. Its approach is described in section 1.
- An uncommitted attempt to add a building-panel step to split-smoke was reverted. The Town Center click did not
  open the panel. The `hb-interact` button approach was never verified.
- `server/character-sheet-test.mjs` fails 3 checks. This was already the case before the split: it was run on the
  unmodified tree at the start of this session. `client/render-depth-test.mjs` passes.
- `npm run smoke` was not run.
- HANDOVER-CODEX.md section 2 has not been updated yet.

## 7. Round 2 (2026-11-27, continuing from c0d1c72)

Baseline rebuilt in the real checkout at c0d1c72 (not from `git archive`: an exported copy lacks untracked local
files, which changes the generated world). Every comparison below is against that baseline: `split-smoke.mjs --port
31950 --baseline <scratch>/baseline`. The smoke builds the client itself into `<out>/dist` (vite, scratch dir),
so that build doubles as the per-commit production build check. Baseline main chunk: 983,323 bytes.

| Commit | Module | Module lines | main.ts after | Smoke | Max pixel diff (frozen / running) | Main chunk |
|--------|--------|--------------|---------------|-------|-----------------------------------|------------|
| (seam 14) | `game/strategyView.ts` | 744 | 5391 | PASS | 0.56% / 0.86% | 988254 |
| (seam 15) | `game/selection.ts` | 282 | 5144 | PASS | 0.62% / 0.78% | 989819 |
