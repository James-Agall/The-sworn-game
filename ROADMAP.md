# colony2d — Balance Review & Roadmap

A full pass over everything built this session: what's solid, what's rough, what's unbalanced,
and where the game could go from here. Written as a planning document, not a task list to execute
blindly — the "Open questions" section at the end needs your input before some of this gets
prioritized.

---

## 1. Current state (what actually exists today)

**Economy:** wood/iron/rock gathering, grain/meat/fruit farming (two separate production
pipelines — Barn+FarmPlot for grain, farmhand-staffed Pasture/Orchard/Wool/Cotton farms for
everything else), Tailor/Blacksmith/Jeweler crafting chains, Market (resource exchange),
Trading Post (gold shop), Brewery→Tavern (grain→alcohol→gold), Bazaar.

**Population:** Town Center grants a flat +10 cap; Houses stack on top (House→Big
House→House Lv2).

**Military:** Knight (Barracks→Castle Lv2→Lv3), Archer (Archery Range/Tower), Militia→Spearman→
Pikeman (double garrison, weaker per-unit), Bishop (healer). Full RTS layer: drag-select,
move/attack orders, task forces, Age-of-Empires-style box formations.

**Happiness:** colony-wide 0-100 score from food variety + scenery (tree density) + tavern
coverage, multiplies all production speed, drives desertion (<35, 15% nightly chance per soldier)
and mutiny (<15, whole garrison deserts). Deserters become a dormant hostile mob at the spot they
deserted, aggroing into a coordinated night-wave attack after 10 days if still alive.

**Monsters:** 10 kinds (Goblin → ... → Ogre), day-gated weighted night spawning, 3 special
mechanics (Troll regen, Giant Spider poison, Dark Shaman heals nearby wounded mobs).

**World (landed):** map expanded to 80x80 (6400 tiles). 3-biome system (Plains ~51%, Hills ~24%,
Swamp ~24%) with real gameplay effects — Swamp -25% movement speed, Hills +20% mining speed,
Plains +20% farming speed. Impassable water ponds (8-12 per map, kept clear of spawn). Ruins
(undead-themed: skeleton/dark shaman/orc) and Encampments (bandit-guarded, bandit is currently
placeholder art reusing the Militia sprite) — both are world-gen POIs with dormant guardians that
only aggro when one of them is attacked, at which point the whole site wakes together. Deterministic
decorative nature scatter (grass/flowers/bushes) on Plains tiles.

**Known rough edges from this round, worth knowing:**
- Guards auto-engage anything within 7 tiles, so building military near a Ruin/Encampment will
  wake it without you choosing to.
- Water renders filling its tile exactly, under other tile art (a deliberate deviation from the
  normal building box-fit scaling, which would have made it spill into neighboring tiles).
- All Ruin/Encampment decoration tiles (including campfires, statues, rubble) block movement —
  a deliberate "one consistent rule" choice, easy to loosen later if some should be walkable.
- Trees can occasionally regrow on a tile a dormant guardian is standing on (cosmetic only — it
  walks out once woken).
- Welcome payload grew to ~26KB (tiles + biomes) and snapshots carry ~40 more world-gen mobs;
  noted as likely fine but not load-tested.

**Art:** every colonist, the player, every monster, and every building has real sprite art.
Knight and Archer have walk/attack animations; everything else is still a static pose (full
outstanding list + prompts in `SPRITES.md`).

---

## 2. Known bugs/gaps already identified but not yet fixed

These surfaced during this session's own testing and were explicitly flagged by the
implementing agents or caught in review, but deliberately left as-is at the time (out of scope
for whatever round was running, or waiting on a decision):

- **Town Center z-order:** a building placed in the row directly above the Town Center can draw
  over its banner. Cosmetic, only matters if you build right there.
- **Deserters never respawn into their post** — a post that loses a unit to desertion stays
  short-handed until its next tier upgrade refills it. Knights already behave this way (a
  pre-existing gap, not new).
- **Happiness reads 100 for exactly one tick after a restart**, then immediately recomputes down
  to whatever a fresh world's food-variety/scenery/tavern score actually is (currently ~43 on a
  totally fresh map with no farms built yet). Cosmetic, but worth knowing the "100" never really
  means anything.
- **A knight/archer/militia respawn that lands the same tick as a tier upgrade can overshoot by
  one unit** (the upgrade tops the garrison up to its new target count, then the queued respawn
  adds one more). Edge case, low impact.
- **`abbey-ward-test.mjs` section B is flaky**, surfaced while verifying the Ward Priest rework
  (2026-10-12): night mobs sometimes head for the player instead of the Town Center even though
  only the Abbey's always-on ward is in play (no Ward Stones placed), which that section didn't
  touch or change. Not investigated yet; may be a pre-existing mob-targeting race, not a Ward
  Priest regression - the player took no damage either run.

## 3. Balance concerns worth a deliberate pass (not bugs — design choices that haven't been
stress-tested)

- **Flat gold-per-kill (5) regardless of monster tier.** A Goblin and an Ogre currently pay out
  identically. Once the monster roster is actually played across a full day-progression, this
  will probably feel wrong — killing an Ogre should pay meaningfully more than a Goblin.
  Suggest scaling reward with the monster's own `maxHp`/`damage` (similar to how deserter damage
  was derived from the deserting unit's own stats) rather than hand-picking 10 numbers.
- **Fresh-colony happiness baseline (~43%) means ~28% slower production from minute one**, before
  you've had a chance to build a single farm. This was flagged once already mid-session and never
  resolved either way — still an open call on whether that's intended "early pressure" or just
  friction. See open questions below.
- **Tavern happiness-coverage radius (6 tiles)** was tuned against a compact 40x40 colony. Once
  the map expands to 80x80 and colonies plausibly sprawl further, a single Tavern may struggle to
  cover a whole base, making happiness harder to sustain than intended purely as a side effect of
  map size, not a deliberate difficulty choice.
- **Biome bonuses (Hills +20% mining, Plains +20% farming, Swamp -25% speed)** are designed but
  completely unplayed — these numbers are a first guess, not a tuned result.
- **Ruins/Encampment risk-vs-reward is unset.** Dormant guardians pay the same flat 5 gold per
  kill as any other mob once provoked — there's currently no reason to specifically seek out and
  clear a site beyond curiosity, since nothing marks them as more rewarding than an ordinary
  night-wave kill.
- **Formation system was just rewritten to proper AoE-style blocks but never played with a large
  mixed army** — worth confirming it actually reads well at 15-20+ units before trusting it's
  "done."
- **Militia-line's "double garrison, half stats" curve** was designed by halving Knight's numbers
  cleanly, not from any playtesting — reasonable as a first pass, unconfirmed as a good one.

## 4. Rough edges / incomplete systems

- Only Knight and Archer have movement/attack animations; everyone else still teleport-glides
  between static poses. (Tracked in `SPRITES.md`.)
- No combat VFX beyond a plain line for ranged attacks — no slash, hit-spark, or death effect.
- Farm Plot has no visual distinction between "growing" and "ready to harvest."
- No UI resource icons — the Colony panel is text-only.
- "Mutiny" was deliberately scoped down to "whole garrison deserts" rather than "soldiers turn
  hostile and fight you" — a disclosed simplification from when the happiness system was built,
  not a bug, but worth remembering it's not what the word usually implies.
- No persistence — the world is entirely in-memory and resets completely on restart or server
  reboot. Fine for a 2-player local session, a real limitation for anything longer-lived.
- No win condition or progression milestones — the game is pure endless survival. May be
  intentional for this project, may not be.

---

## 5. Proposed near-term plan

1. ~~Finish what's in flight: map expansion, biomes, water, Ruins/Encampments.~~ **Landed** —
   biome ratio corrected to ~51% Plains after launch (was ~30% before a quick follow-up fix).
   Worth an actual in-browser look before trusting the rest of this list, since nothing about it
   has been seen visually yet (built and tested entirely without a browser).
2. **Fix the Town Center z-order bug** — small, isolated, clearly a bug not a design choice.
3. **Gold-per-kill scaling by monster tier** — small, mechanical, clearly an improvement over a
   flat number now that the full roster (plus Ruin/Encampment guardians) is in regular use.
4. **A real playtest pass** now that the map/biome work has landed: build a colony, let a few
   in-game days pass, see how happiness/production/military/biome bonuses actually feel at normal
   play speed, before tuning any more numbers blind.
5. **Keep working through `SPRITES.md`** as art comes back from chat — animations for the
   remaining soldiers/civilians/monsters, the Bandit's own dedicated art (replacing the Militia
   placeholder), UI icons, combat VFX, farm growth states.

## 6. Where this could go longer-term (needs your direction, not a default I should assume)

- **Persistence** — save/load world state, so a colony survives a server restart.
- **A win condition or progression structure** — milestones, a final boss wave, a "you've
  survived N days" framing, something to play toward rather than pure endless survival.
- **More than 2 players** — nothing in the current architecture hard-blocks it, but it's never
  been tested with 3+, and the player-color palette currently has 5 entries (red/blue/green/
  yellow/purple), so that's the practical ceiling as it stands.
- **Deeper Ruins/Encampment rewards** — right now they're just "a fight with extra steps"; could
  gain their own loot table, a unique resource, or a cosmetic reward for clearing them.
- **Biome-specific building variants or decorations** beyond the ground texture (e.g. a
  snow-biome building reskin), if biomes prove to be a system worth investing further in rather
  than just a visual/bonus layer.

---

## Open questions (need your call, not mine)

- Is the harsh early-game happiness penalty (~43% baseline, ~28% slower production from the
  start) intended pressure, or should it be softened?
- Is "endless survival" the intended shape of the game, or do you want a progression/win
  structure eventually?
- Is persistence (saving a colony across restarts) something you actually want, given this is a
  2-player local session game, or is in-memory-only fine indefinitely?
- Any appetite for more than 2 players, or is this staying a 2-player game?

---

## 7. Content & Feel Expansion Plan (2026-10-09)

A large batch requested in one go. Grouped into sequential phases — mostly because nearly
everything below touches the same three monolith files (`server/src/index.ts`,
`protocol.ts`, `client/src/main.ts`), so true parallel dispatch risks collision (this bit us
once already this session, with the Half-Latch/Stance dispatches). Phases run one at a time,
each verified and committed before the next starts. Numbers marked **(judgment call)** are a
reasonable first pass, not something confirmed with you — flag if they feel wrong once played.

### Phase 1 — Foundation (map, camera, clock)
- **Map → 160x160.** `WORLD_TILES_X/Y` become overridable (env var or test-only override) so the
  existing `server/*.mjs` test suite keeps running at 80x80 while real play defaults to 160x160.
  World-gen density (POI counts, tree/resource scatter, water ponds) scales with area (~4x) to
  avoid a 4x-emptier-feeling map.
- **Zoom in 30%.** `worldLayer.scale.set(1.3)`, camera-follow math adjusted to account for the
  new scale.
- **Day/night cycle extended. (judgment call)** Currently 30s day / 20s night (50s/cycle).
  Proposing 60s day / 40s night (2x, same 60/40 ratio) — easy to retune once it's playable.
- **Sundial clock HUD.** CSS/SVG dial (no new art dependency) whose gnomon shadow rotates with
  cycle progress; swaps to a moon/star look at night.

### Phase 2 — Combat feedback & notifications
- **Gravestones.** `gravestone.png`/`gravestone2.png` already exist in `client/public/sprites/`
  but are unused — wire them up now. On a colonist/soldier death, drop one (random variant) as a
  transient decor entity (not a tile, so it doesn't collide with buildable-tile logic) at the
  death position; auto-removed at the next day-cycle boundary.
  Visual health (bleeding, armor deterioration) — explicitly deferred, "in future," per your
  note. Health bars stay as-is for now.
- **Event notification feed.** New `ServerMessage` type (`event`), toast-style stacked DOM
  feed, auto-fades. Triggers: night falling/survived, building tier-upgraded, colonist died,
  ward lapsed, deserter wave, boss/mini-boss sighted, milestone reached.

### Phase 3 — Old-fashioned UI skin
- Parchment/aged-paper background for the build panel and economy panel (derived from the scroll
  reference image you provided), serif heading font (system serif fallback, no external font
  fetch), carved/aged border treatment via CSS. Scoped to the two main panels first; toggle
  buttons and HUD chrome follow if it reads well.

### Phase 4 — Fog of war minimap
- Explored-tile tracking (radius around players/colonists/buildings, persists once seen — not
  live line-of-sight, this is co-op not competitive), small corner minimap canvas: dimmed
  unexplored, terrain-tinted explored, live dots for players/colonists/mobs/buildings in current
  vision range. More load-bearing once the map is 160x160.

### Phase 5 — Short-term goals & the Castle Ruin
- **Goal track:** tutorial-style first steps (place a building, assign a worker, arm a unit,
  survive the first night) → "survive N nights" milestones → final objective: clear the Castle
  Ruin.
- **Castle Ruin:** one large, singular POI (bigger footprint than a normal Ruin), dense guardian
  count, dormant-until-provoked (reusing the existing Ruin/Encampment wake mechanic).
- **Boss:** an upscaled Ogre variant (bigger render size, stat multiplier **(judgment call,
  proposing ~4-5x HP, ~2x damage)**) guarding the Castle Ruin's center.
- **Mini-bosses:** standalone POIs scattered on the map — one upscaled elite of a given kind
  leading 2-4 normal mobs of that same kind, same dormant/wake pattern.

### Phase 6 — Hunger-marked elites (lore-accurate, from `my_novel/lore/bestiary.md`)
Rare marked variants of existing mobs, one behavior modifier per Hunger (verbatim from the
bestiary, translated to gameplay):
- **Gorrath-marked** — frenzied: fights through what should be lethal damage (brief reduced-damage
  "wounded fury" state near death), targets the strongest unit/player in range rather than the
  weakest.
- **Nemri-marked** — avoids direct engagement, makes for whatever's being guarded (a building/
  objective) rather than whoever's guarding it.
- **Rux-marked** — the "talks back" one: taunts/fake signals (gameplay translation TBD at
  implementation time — likely a deceptive feint before committing to an attack).
- **Morvain-marked** — hard to track: reduced detection/aggro range against it, harder to keep a
  lock on once it breaks line of sight.
- **Gunne-marked** — targets the most wounded (lowest-HP%) unit specifically, ignoring healthier
  targets if one is available.
- **Vhorrun-marked** — hit-and-run: withdraws instead of finishing a fight it's winning, returns
  later rather than pressing an advantage.
Visually distinct (tint/aura + name label), rare spawn chance scaling with day, bonus gold/loot
on kill.

### Phase 7 — Sound (plan only, not built yet)
Free/CC0 sources (Kenney.nl, OpenGameArt, itch.io free packs) once you want to move on this.
Categories: UI clicks/placement, chop/mine, combat hit/death, night-falling sting, victory
jingle, ambient day/night loop. Implementation: a client-side `SoundManager` over the Web Audio
API, preloaded short clips, triggered off the Phase 2 event feed plus local UI actions.

Execution order above is my default sequencing (foundation first since map/zoom/clock touch
everything downstream); say the word if you want a different item first.
