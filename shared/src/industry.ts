// Industry extras (docs/colony2d/PLAN-agri-industry-winter-mines.md phase 6; ROADMAP "Industry extras — landed").
// Bronze (copper + tin at the Foundry: a tools / gear tier between stone and iron), the Stamp Mill (crushes and washes
// ore: washed tin, gold dust, sand), limestone (flux) -> steel at the Blast furnace (Fine steel forges better gear), the
// Glassworks (glass, window glass, bottles), the Mint (coins into the treasury) and lead (glazed tableware). The
// stations, items and recipes themselves are rows of shared/src/progression.ts; every number of their effects lives
// here (server + client). Under COLONY_UNLOCK_ALL the effects are off (the older suites never see them).
import { TileType } from "./protocol.js";

// ---- buildings ----
// The new artisan stations (one worker each, 3 levels, upgrade = build cost x the new level).
export const INDUSTRY_STATION_TILES: readonly TileType[] = [TileType.Foundry, TileType.StampMill, TileType.Glassworks, TileType.Mint];
// A new Stamp Mill washes its ore: water (a pond / river Water tile or a dug Moat) within this many tiles.
export const STAMP_MILL_WATER_RADIUS_TILES = 3;

// ---- bronze (T1.5: better than stone, below iron) ----
// Bronze tools in store: the hero chops / quarries / mines this much faster, and the clan's woodcutters, quarrymen,
// miners and diggers work this much faster (the stone tools are still needed: bronze is an edge, not a gate).
export const BRONZE_TOOL_SPEED = 1.2;
// Bronze gear: a soldier (knight, spearman, pikeman, cavalry) with no iron piece in a slot takes a bronze one from the
// stores when it musters or re-arms (gear pickup); an iron piece later replaces it and the bronze goes back to the
// stores. Bronze weapon: damage x1.1 (iron T1 x1.2); bronze armour: damage taken x0.92 (iron T1 x0.85).
export const BRONZE_WEAPON_DAMAGE_MULT = 1.1;
export const BRONZE_ARMOUR_DAMAGE_TAKEN_MULT = 0.92;

// ---- steel ----
// Steel is made at the Blast furnace (Bloomery level 2+) by a level-2 smelter: 2 iron blooms + 1 limestone (flux) + 2
// charcoal (or coal); its grade is the furnace's tier like every station's (a level-3 furnace with a level-3 smelter
// makes Fine steel). Forging at a Blacksmith with Fine (grade-3) steel in store: one Fine steel is used per piece below
// tier 3 and the piece comes out STEEL_FINE_TIER_BONUS tier better (a level-2 forge makes tempered, tier-3 gear). Poor /
// Good steel waits in the stores (it counts for nothing at the forge).
export const STEEL_FINE_TIER_BONUS = 1;

// ---- glass ----
// The Glassworks' glassblower melts 2 sand + 1 limestone (lime) + 1 charcoal (or coal) into 2 glass, then blows window
// glass (2 glass + 1 wood -> 2 panes) and bottles (1 glass -> 2). Window glass in store (at least GLAZED_WINDOWS_MIN
// panes): every window of the clan's rooms is glazed: it loses no heat and adds GLAZED_WINDOW_BEAUTY beauty point
// (a rug is 3, a statue 8). Bottles in store (at least BOTTLES_MIN) with ale in store: the ale's happiness bonus is
// BOTTLED_ALE_BONUS higher (bottled ale keeps and is served better).
export const GLAZED_WINDOWS_MIN = 4;
export const GLAZED_WINDOW_BEAUTY = 1;
export const BOTTLES_MIN = 4;
export const BOTTLED_ALE_BONUS = 2;

// ---- the Mint ----
// The Mint's minter strikes 2 gold dust + 1 charcoal into MINT_COINS_PER_BATCH coins; struck coins go straight into the
// treasury: MINT_GOLD_PER_COIN gold each x the grade's value (Poor 1, Good 1.25, Fine 1.5), rounded down.
export const MINT_COINS_PER_BATCH = 5;
export const MINT_GOLD_PER_COIN = 4;

// ---- lead ----
// The Foundry smelts lead (2 lead ore + 1 charcoal -> 2 lead) when it has no bronze to make. The Kiln glazes tableware
// with it (2 clay + 1 lead + 1 wood -> 2 tableware) LEAD_GLAZE_GRADE_BONUS grade better than plain (at most Fine).
export const LEAD_GLAZE_GRADE_BONUS = 1;
