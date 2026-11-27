# Inventory, ground drops and the Town Center chest (26 November 2026)

> **Interior fixes: status** (branch `interior-fixes`, 2026-11-27)
> 1. Gear deposit to the armoury: done (commit 1).
> 2. Drops inside hostile interiors: done (commit 2; browser check with commit 3).
> 3. Hotbar and spells inside hostile interiors: in progress.

Branch `pack-inventory-ground-drop`. Manual check: MANUAL-TESTS.md "Inventory, drop and town centre chest".

## Design

- **Pack (gear)**: the hero sheet's left column is a fixed grid of `HERO_INVENTORY_CAP` (40) slots, 5 columns (8 on a
  narrow single-column sheet). Filled slots use the existing item icon logic (`gearIconUrl`, else `/sprites/<icon>.png`,
  else the coloured placeholder with a per-kind glyph) and the existing tier borders. Tooltip on hover and on keyboard
  focus: name, tier, the item's own slot (and weapon kind), every non-zero stat (or "No stat bonuses"), compared with the
  equipped piece. Click / Enter equips (tomes: Learn). Right click, the context-menu key or Shift+F10 opens a small menu
  (Equip / Learn / Drop / Cancel; arrows move, Escape closes and refocuses the slot); Delete drops. The equipment stand
  (head, chest, weapon, off-hand, legs) is unchanged: click to unequip.
- **Carried goods** (`HeroLife.pack`), under the grid: one row per good (icon `/sprites/icon-<good>.png`, letter
  fallback for fish), ×count, weight, Drop 1 (Shift: 10) and All, a load bar `weight / 40` (amber over half: "you walk
  slower"; red when full: "can't gather more"), and Deposit into stockpile. Eat / Rest stay below. The stockpile panel's
  "With hero" list and Deposit button are unchanged.
- **Ground stacks** (`server/src/groundItems.ts`): `GroundItem {id, x, y, kind: good|gear, good?, qty?, gear?,
  droppedAtTick, dropperKey}` in one global insertion-ordered map. A drop lands on the walkable tile nearest the hero's
  feet within 1.5 tiles (their own tile first) at its centre; the same good on the same tile merges (timer restarted).
  Pick up within 1.5 tiles: by E (after an own storage chest in reach and talking: the nearest stack in reach; doors, tools and gathering come after it)
  or by clicking the stack (`pickupGround`). Goods take what fits under PACK_CAP and leave the rest; gear respects the
  40-item cap. The client draws stacks statically (goods icon on a burlap tile / gear icon on a tier-coloured tile, a
  small shadow, a count) and fans out stacks sharing a tile; the nearest stack in reach gets "E: pick up …", a hovered
  one "Click: pick up …".
- **Great hall chest**: in an own Town Center / Keep hall (ground floor) E at the chest opens "Hall chest": "Deposit
  carried goods into your shared stockpile" with Deposit all, Deposit N <good> per carried good, Open shared Stockpile
  and Use the hall chest (private storage: the old pack <-> chest dialogue). Every hall template (3 variants) has a
  chest reachable from the entrance (tested); redecorating a hall can no longer remove its last chest. Stairs no longer
  win E over a chest or bed beside them (stepping on stairs travels; E there only said so).
- What pre-existed: the hall template's required chest, the chest's "Open shared Stockpile", and `deposit` working
  anywhere inside an own interior or within 4 tiles of a Town Center. New: the deposit-first hall chest panel,
  per-good deposit, the keep-the-chest rule, the stairs priority fix, and the tests.

## Protocol additions (all additive)

- Client: `{type:"dropGood", good, qty}`, `{type:"dropGear", itemId}`, `{type:"pickupGround", id}`;
  `heroAction` gains optional `good` (deposit only that good).
- Snapshot: `ground?: GroundItemSnapshot[]` (`{id, x, y, k:"g"|"e", good?, qty?, name?, tier?, slot?, kind?, icon?}`),
  per player, appended like `livestock` (outside the delta encoding), sent only when that player's list changed, `[]`
  when emptied / indoors; reset (resent) on every welcome. Gear on the ground shows name / tier / slot / kind / icon only.
- Dialogue actions `hallDeposit` (arg `all` or a good) and `chestPrivate`.
- Save: `groundItems: {items: GroundItem[]}` (optional; current format only), cleared by `resetWorld`.
- Test hook `groundItems` (`clear`, `spawn {n, good, x, y}`, `drop`, `dropGear`, `pickup`; replies the list, `max`,
  `despawnTicks`, `dropperDelayTicks`).

## Caps and limits

| Rule | Value |
| --- | --- |
| Stacks per world | 300 (`GROUND_MAX_ITEMS`; a new one evicts the oldest) |
| Drop / pickup reach | 1.5 tiles |
| Dropper's own pickup delay | 1.5 s (30 ticks; others may take it at once) |
| Drop rate | 6 per player per real second ("Slow down") |
| Despawn | 3 game days (`3 * GAME_DAY_TICKS` = 22 500 ticks), checked once a second |
| Snapshot | stacks within `SNAPSHOT_VIEW_TILES` (60) of the hero or inside the strategy view rect; list rebuilt only when the stacks change, the hero crosses a 4-tile cell or the view changes |

Validation: unknown goods / non-string ids are ignored; quantity must be a positive integer (else "Choose how many to
drop") and is capped to what is carried; gear must be in the sender's own pack (equipped: "Unequip that first";
otherwise "That item is not in your pack"); dead heroes do nothing; inside any interior: refused; no walkable tile in
reach (water / solid all round): "No clear ground here to drop that". Per-tick cost: nothing per tick except a modulo
check; the despawn sweep (≤300) once a second; snapshot filtering only when the key changes.

## Tests

- `server/ground-items-test.mjs` (`npm test -- ground-items`): drop + merge, snapshot list, bad types / negative /
  fractional / string / huge quantities, rate limit, dropper delay, weight-capped pickup with remainder, full pack,
  reach, E pickup, another hero's pickup, gear drop / equipped / other hero's item / dead / indoors / water, 40-item
  gear refusal, near-only list and no resend, 300 cap eviction, despawn after 3 days (fastForward), save / load round
  trip, new world clears.
- `server/hall-chest-test.mjs` (`npm test -- hall-chest`): walk into the Town Center door, all 3 hall variants have a
  reachable chest and valid templates, Hall chest panel (deposit one good, deposit all incl. fish -> meat, private
  chest), redecorated hall keeps its chest, per-good deposit near the Town Center, refusal far away.
