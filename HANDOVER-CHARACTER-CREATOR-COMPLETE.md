# Character creator completion handover

## Character creator — completed 2026-11-16

The player now uses separately painted body parts on a shared skeleton. The creator opens before New Game, Solo and Creative;
Continue/Load skips it. Reopen **Hero → Edit appearance** during play. Name, body, three builds (−7% / average / +7% height), three faces,
four hairstyles, six hair colours, five skin tones and five horse coats persist on the existing server profile.

Head, body armour, weapon and shield are the player's four equipment slots. The armoury supplies all three tiers from existing forged stock.
Sword, axe, spear and bow use the same rig; axes hit 25% harder with 25% longer cooldown (rounded to ticks). Spear reach and bow range use existing combat.
The server refuses bow + shield in either order. Recruited heroes retain their legacy gear and spell systems.

Rendering uses real head/torso/pelvis/upper-arm/forearm/thigh/shin/foot/hair/helm/weapon/shield PNGs. Skin/hair/horse palette changes preserve shading.
Idle, movement-driven planted-foot walking, weapon attacks, mounted poses and hurt recoil share the skeleton. Existing crimson wound splashes remain.
World, indoor, creator and other players' views use the same parts and height. Real horse ownership/mounting is unchanged; the creator's mount toggle is a preview.
Optional part loading falls back to the existing hero art. Art remains transparent and existing sprite files are untouched.

Art: four source atlases (#106–109), 69 distinct painted pieces plus 14 default aliases in `client/public/rig/parts/painted-v1`.
Sources and original generation prompts: `art-sources/character-creator-20261116` (local source archive, not committed).
Observed crop rectangles, pivots, output padding and a mild rim palette adjustment are reproducible from `scripts/rig-layouts/painted-*.json`.
The slicer now discards disconnected translucent noise while preserving antialiased edges. #109 supplied three bows; arrows use the existing projectile effect.

Verification: client/server/shared typechecks; slicer round-trip, messy-background and translucent-noise regression; targeted appearance, character-sheet,
equipment, hero, hero-tools and snapshot-delta suites. Contact sheets cover 2 bodies × 3 builds × 4 weapons × 4 armour levels × 8 foot/mounted poses,
plus all face/hair pairings and an existing-hero comparison at game size. Representative head/torso/helmet art validation passes.
Private browser checks cover creator → Creative restart, edit/save, real horse mounting, house interior, Continue with restored appearance,
Solo restart, Escape cancellation and missing-art fallback. Production build and browser checks use scratch saves/private ports.

No live deployment and no push. Long multiplayer play sessions and subjective animation polish remain manual review items; the checked combinations render and integrate.

Main implementation: `client/src/heroRig.ts`, `characterCreator.ts`, `characterCreator.css`; small integration changes in `main.ts` and `interior.ts`.
Data/rules: `shared/src/protocol.ts`, `server/src/heroes.ts`, `server/src/index.ts`. Targeted regression: `server/appearance-test.mjs`.
Art QA: `scripts/character-rig-contact.mjs` exports `renderRigContactSheets(page, outputDir)` for a private Playwright preview session on Vite.
Local screenshot/report folder: `C:/Users/maxim/Documents/Codex/2026-11-10/go-x20/outputs/character-creator`.
Use `character-lineup.png`, `hair-and-faces.png`, six `rig-*-build*.png` sheets and `visual-check.json`.

Raw sources, earlier work, six pre-existing modified tests and the original untracked handover/tools were left out of the implementation commit.
