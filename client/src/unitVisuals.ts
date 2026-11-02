// Unit visuals: colonist / mob colours, roles, sprite URLs and animation tables (split out of main.ts, no behaviour change).
import {
  type ColonistKind, type CombatRole, type FormationShape, type MobKind, type Stance, TILE_SIZE, TileType,
} from "@colony/shared/protocol";

export const COLONIST_COLORS: Record<string, number> = {
  lumberjack: 0xd4a04c,
  farmer: 0x8fbf4d,
  knight: 0x7f8fa6,
  archer: 0x5fa8d3,
  ironMiner: 0xb8b8c8,
  rockMiner: 0x8d7b68,
  bishop: 0xf0e6d2,
  farmhand: 0xf28c38,
  artisan: 0xb36be0,
  militia: 0xc9a27a,
  spearman: 0xa86a3c,
  pikeman: 0x7a3f1e,
  hunter: 0x6b7d3a,
  forager: 0xc9a46a,
  builder: 0xb0784a,
  cavalry: 0x8fa3c0,
  batteringRam: 0x7a5230,
  catapult: 0x6b4a2a,
  hero: 0xf2c94c,
};

// Only military units take part in selection / commands / task forces.
export const COMMANDABLE_KINDS = new Set<string>([
  "knight", "archer", "bishop", "militia", "spearman", "pikeman", "cavalry", "batteringRam", "catapult", "hero",
]);
// Workers who vanish into their building/plot while on the job, instead of standing visibly on
// top of it. Guards/militia/bishop stay visible — you want to see your garrison standing watch.
export const WORKER_KINDS = new Set<string>([
  "lumberjack",
  "farmer",
  "ironMiner",
  "rockMiner",
  "farmhand",
  "artisan",
  "hunter",
  "forager",
  "builder",
]);
// Workers (and civilians sheltering at night, below) read as going inside their building. Garrison
// units, archers included, always stay visible.
export const HIDE_AT_POST_KINDS = new Set<string>([...WORKER_KINDS]);
export const AT_POST_HIDE_RADIUS_PX = 6;
// Buildings whose garrison (knights/archers with matching postX/postY) can be click-selected.
export const GARRISON_TILES = new Set<number>([
  TileType.KnightPost,
  TileType.CastleLevel2,
  TileType.CastleLevel3,
  TileType.ArcherPost,
  TileType.MilitiaPost,
  TileType.MilitiaCamp2,
  TileType.MilitiaCamp3,
  TileType.Stables,
  TileType.SiegeWorkshop,
]);
export const SELECTION_COLOR = 0x00e5ff;
export const DRAG_THRESHOLD_PX = 6;
export const UNIT_HIT_RADIUS = 10;

// Role rings drawn under soldiers and monsters (see drawRoleRings).
export const ROLE_COLORS: Record<CombatRole, number> = {
  frontline: 0xd8a24a,
  shock: 0xc0392b,
  ranged: 0x58b85c,
  caster: 0x9b6fd6,
  fast: 0x4fb3e8,
  siege: 0x8b5a2b,
};
export const ROLE_LABEL: Record<CombatRole, string> = {
  frontline: "Frontline",
  shock: "Shock",
  ranged: "Ranged",
  caster: "Caster",
  fast: "Fast",
  siege: "Siege",
};
// Stance hotkeys. 'c' (the AoE-style third key) is the Church build tool, so aggressive is 'e'.
export const STANCE_HOTKEYS: Record<string, Stance> = { z: "defensive", x: "normal", e: "aggressive" };
export const STANCE_LABEL: Record<Stance, string> = { defensive: "Defensive", normal: "Normal", aggressive: "Aggressive" };
// Strategy mode phase 4: formation shape names (command bar, cards).
export const SHAPE_LABEL: Record<FormationShape, string> = { line: "Line", block: "Block", wedge: "Wedge", loose: "Loose" };
// Per-unit move orders go out one at a time, units already closest to their own slot first, this
// far apart; the step shrinks for big groups so the last unit never waits more than the max spread.
// Measured with server/formation-test.mjs (stacked-sprite time on 90/180-degree turns), this beat
// both sending everything at once and sending whole ranks front-first.
export const FORMATION_DISPATCH_STEP_MS = 80;
export const FORMATION_DISPATCH_MAX_SPREAD_MS = 800;
// Destination marker for a formation move: stays until every unit has stopped walking (arrived, or
// peeled off to fight), then fades. Hard cap in case a unit never settles.
export const FORMATION_MARKER_MIN_MS = 700;
export const FORMATION_MARKER_MAX_MS = 60000;
export const FORMATION_MARKER_FADE_MS = 400;
// Minimum click-to-target radius; bigger kinds get half their rendered sprite size instead
// (see mobHitRadius) so trolls/ogres are clickable anywhere on their body.
export const MOB_HIT_RADIUS = 12;

// Per-kind mob size: radius scales roughly with toughness so size alone reads as a threat cue.
// Human-sized kinds (bandits, skeleton, shaman) stay close to the 28px colonist height (radius 8).
// Drives the sprite's rendered size (radius * MOB_SPRITE_SIZE_PER_RADIUS along the texture's
// longer side) and, if a texture is missing, the fallback colored circle.
export const MOB_VISUALS: Record<MobKind, { color: number; radius: number }> = {
  goblin: { color: 0xa4c639, radius: 7 },
  wolf: { color: 0x8a8a8a, radius: 7.5 },
  goblinCrossbow: { color: 0x6b8e23, radius: 7 },
  orc: { color: 0x3d7a2a, radius: 9.5 },
  skeleton: { color: 0xe8e0c8, radius: 8.5 },
  armoredOrc: { color: 0x4a5a3a, radius: 11 },
  darkShaman: { color: 0x4b1f6b, radius: 8 },
  giantSpider: { color: 0x1e1a1e, radius: 8.5 },
  troll: { color: 0x3b4a2a, radius: 13 },
  ogre: { color: 0x8b5a2b, radius: 15 },
  banditClubman: { color: 0x6b4a2a, radius: 8.2 },
  banditArcher: { color: 0x5a5a3a, radius: 8 },
  // Bandits are people: sized against the 28px colonist (radius 8 ~ 28px). The elite is ~1.25x a
  // regular bandit so it still reads as a step up without towering over the colony's own units.
  banditElite: { color: 0x7a2a2a, radius: 10 },
  // Smaller than a goblin — "barely more than a shadow".
  halfLatch: { color: 0x0e0e12, radius: 5.5 },
  // Siege engines: the raider ram / catapult sets (MOB_OPTIONAL_VARIANT_URLS); cart / crate props, tinted
  // (MOB_TINT), if those files are missing.
  batteringRam: { color: 0x7a5230, radius: 13 },
  catapult: { color: 0x6b4a2a, radius: 12 },
  // Goblin wolf rider: a wolf with a goblin on its back, a little bigger than a bare wolf.
  goblinRider: { color: 0x9a7a4a, radius: 9 },
  // Forts phase C: human settlement guards / workers, colonist-sized, drawn with the colonist sets (MOB_VARIANT_URLS).
  townGuard: { color: 0x3a5a9a, radius: 8 },
  townArcher: { color: 0x3a5a9a, radius: 8 },
  townKnight: { color: 0x2a4a8a, radius: 8.5 },
  townFarmer: { color: 0x8a7a4a, radius: 8 },
  townMiner: { color: 0x6a6a6a, radius: 8 },
  townPriest: { color: 0xd8d0b8, radius: 8 },
};
export const MOB_KINDS = Object.keys(MOB_VISUALS) as MobKind[];
// Mob kinds whose texture isn't /sprites/<kind>.png.
export const MOB_SPRITE_URL_OVERRIDES: Partial<Record<MobKind, string>> = {
  halfLatch: "/sprites/halfLatch0.png",
  banditClubman: "/sprites/banditClubmanWalk0.png",
  banditArcher: "/sprites/banditArcherWalk2.png",
  banditElite: "/sprites/bandit.png",
  batteringRam: "/sprites/cart.png",
  catapult: "/sprites/crate.png",
  goblinRider: "/sprites/wolf.png",
  // Settlement folk have no art of their own; borrow the colonist sprites (tinted via MOB_TINT below).
  townGuard: "/sprites/militia.png",
  townArcher: "/sprites/archer.png",
  townKnight: "/sprites/knight.png",
  townFarmer: "/sprites/farmer.png",
  townMiner: "/sprites/rockMiner.png",
  townPriest: "/sprites/bishop.png",
};
// Tints for mob kinds drawn with borrowed (placeholder) art. The goblin wolf rider is the wolf set tinted
// warm brown until its own set (SPRITES.md #83, MOB_OPTIONAL_VARIANT_URLS) lands.
export const MOB_TINT: Partial<Record<MobKind, number>> = {
  batteringRam: 0xb07a4a, catapult: 0x9a7048, goblinRider: 0xd89a60,
  // Forts phase C: settlement guards in blue livery (borrowed colonist art); workers lightly cooled.
  townGuard: 0x9ab4ff, townArcher: 0x9ab4ff, townKnight: 0x9ab4ff, townFarmer: 0xd8e0ff, townMiner: 0xd8e0ff, townPriest: 0xd8e0ff,
};

export const artUrl = (name: string) => `/sprites/${name}.png`;
export const frameUrls = (name: string, count: number) =>
  Array.from({ length: count }, (_, i) => `/sprites/${name}${i}.png`);

// Walk + action (attack, or the worker's chop/mine/heal/... cycle) frame URLs per colonist kind.
// Each row was normalized at extraction onto one shared canvas with the feet on the bottom edge.
// Heroes borrow their class's set (HERO_VISUAL_KIND), so "hero" has none of its own.
export const COLONIST_ANIM_URLS: Record<Exclude<ColonistKind, "hero">, { walk: string[]; action: string[] }> = {
  knight: { walk: frameUrls("knightWalk", 4), action: frameUrls("knightAttack", 4) },
  archer: { walk: frameUrls("archerWalk", 4), action: frameUrls("archerAttack", 6) },
  militia: { walk: frameUrls("militiaWalk", 4), action: frameUrls("militiaAttack", 3) },
  spearman: { walk: frameUrls("spearmanWalk", 4), action: frameUrls("spearmanAttack", 3) },
  pikeman: { walk: frameUrls("pikemanWalk", 4), action: frameUrls("pikemanAttack", 3) },
  lumberjack: { walk: frameUrls("lumberjackWalk", 4), action: frameUrls("lumberjackChop", 3) },
  farmer: { walk: frameUrls("farmerWalk", 4), action: frameUrls("farmerHarvest", 3) },
  ironMiner: { walk: frameUrls("ironMinerWalk", 4), action: frameUrls("ironMinerMine", 3) },
  rockMiner: { walk: frameUrls("rockMinerWalk", 4), action: frameUrls("rockMinerMine", 3) },
  bishop: { walk: frameUrls("bishopWalk", 4), action: frameUrls("bishopHeal", 3) },
  farmhand: { walk: frameUrls("farmhandWalk", 4), action: frameUrls("farmhandTend", 3) },
  artisan: { walk: frameUrls("artisanWalk", 4), action: frameUrls("artisanCraft", 3) },
  // Stand-ins until SPRITES.md #28/#29 land (see COLONIST_OPTIONAL_ANIM_URLS): the hunter borrows the
  // archer's bow cycle, the forager the farmhand's, each tinted (COLONIST_STANDIN_TINT).
  hunter: { walk: frameUrls("archerWalk", 4), action: frameUrls("archerAttack", 6) },
  forager: { walk: frameUrls("farmhandWalk", 4), action: frameUrls("farmhandTend", 3) },
  // Stand-in until the builder frames load (COLONIST_OPTIONAL_ANIM_URLS).
  builder: { walk: frameUrls("lumberjackWalk", 4), action: frameUrls("lumberjackChop", 3) },
  // Cavalry & siege stand-ins, used only if their own sets (COLONIST_OPTIONAL_ANIM_URLS) are missing: the
  // rider borrows the player's ride cycle (tinted blue-grey), the engines the cart / crate props.
  cavalry: { walk: frameUrls("playerWalk", 4), action: frameUrls("playerAttack", 2) },
  batteringRam: { walk: [artUrl("cart")], action: [artUrl("cart")] },
  catapult: { walk: [artUrl("crate")], action: [artUrl("crate")] },
  // Forts phase E: the trader wagon's stand-in is the cart prop (per-level art: WAGON_ART_URLS).
  wagon: { walk: [artUrl("cart")], action: [artUrl("cart")] },
};
// Dedicated art for kinds still on stand-ins. Loaded separately and optionally (loadOptionalTextures):
// when every frame of a set loads it replaces the stand-in set and its tint; missing files are fine.
// `carry` (optional) plays in the server's "carrying" state (walking a carcass / full basket home).
// `height` (optional) is the set's rendered height when it differs from the stand-in's COLONIST_KIND_HEIGHT.
export const COLONIST_OPTIONAL_ANIM_URLS: Partial<
  Record<ColonistKind, { walk: string[]; action: string[]; carry: string[]; height?: number }>
> = {
  hunter: { walk: frameUrls("hunterWalk", 4), action: frameUrls("hunterHunt", 3), carry: frameUrls("hunterCarry", 2) },
  forager: { walk: frameUrls("foragerWalk", 4), action: frameUrls("foragerForage", 3), carry: frameUrls("foragerCarry", 2) },
  // Carry = hauling a plank to a construction site (server state "carrying"); action = hammering.
  builder: { walk: frameUrls("builderWalk", 4), action: frameUrls("builderBuild", 4), carry: frameUrls("builderCarry", 2) },
  cavalry: { walk: frameUrls("cavalryWalk", 4), action: frameUrls("cavalryAttack", 3), carry: [] },
  // Siege engines (SPRITES.md #40/#41). The canvases include the pennant, so they are set taller than the
  // 30px props: the ram renders ~28px wide, the catapult ~44px.
  batteringRam: { walk: frameUrls("batteringRamWalk", 4), action: frameUrls("batteringRamAttack", 3), carry: [], height: 40 },
  catapult: {
    walk: frameUrls("catapultWalk", 4),
    action: [...frameUrls("catapultLoad", 3), ...frameUrls("catapultFire", 3)],
    carry: [],
    height: 38,
  },
};
// Armour & weapons (SPRITES.md #45-#48): a walk + attack set per armour tier 1-3 (ColonistSnapshot.armourTier;
// 0 / omitted = the base set above), loaded optionally. The frames were cut at the base set's pixel scale
// (feet on the bottom edge), so a tier set reuses its base set's `scale`. A tier missing any file keeps the
// base set plus the armour-tier ring (drawRoleRings).
export const TIER_ART_KINDS = ["knight", "spearman", "pikeman", "cavalry"] as const;
export const COLONIST_TIER_ANIM_URLS = Object.fromEntries(
  TIER_ART_KINDS.map((kind) => [
    kind,
    [1, 2, 3].map((t) => ({ walk: frameUrls(`${kind}T${t}Walk`, 4), action: frameUrls(`${kind}T${t}Attack`, 3) })),
  ])
) as Record<(typeof TIER_ART_KINDS)[number], { walk: string[]; action: string[] }[]>;
// Cavalry charge (client-inferred, see cavalryChargeRun): the couched-lance pose replaces the gallop once a
// rider has run CAVALRY_CHARGE_TILES (the server's charge distance) in a straight line, kicking up dust.
export const CAVALRY_CHARGE_URL = "/sprites/cavalryCharge0.png";
export const CAVALRY_CHARGE_TILES = 5;
export const CHARGE_DUST_URL = "/sprites/fx-dust0.png";
export const CHARGE_DUST_MS = 200;
// A destroyed siege engine leaves its wreck at the spot for this long (fading over the last quarter).
export const SIEGE_WRECK_URLS: Record<"colonist" | "mob", Partial<Record<string, string>>> = {
  colonist: { batteringRam: "/sprites/batteringRamDestroyed.png", catapult: "/sprites/catapultDestroyed.png" },
  // Batch 2 (SPRITES.md #83): the goblin wolf rider leaves its last death frame (wolf down) the same way.
  mob: { batteringRam: "/sprites/mobBatteringRamDestroyed.png", catapult: "/sprites/mobCatapultDestroyed.png", goblinRider: "/sprites/goblinRiderDeath2.png" },
};
export const SIEGE_WRECK_MS = 4000;
export const COLONIST_STANDIN_TINT: Partial<Record<ColonistKind, number>> = {
  hunter: 0xb5d39a,
  forager: 0xffd9a8,
  builder: 0xffc890,
  cavalry: 0xa8b8d8,
  batteringRam: 0xc89a6a,
  catapult: 0xb08a60,
};
// Rendered height (px) per kind where it isn't COLONIST_SPRITE_HEIGHT (a rider on a horse, engines).
export const COLONIST_KIND_HEIGHT: Partial<Record<ColonistKind, number>> = { cavalry: 50, batteringRam: 30, catapult: 30 };
// Static (fallback) pose per kind when it isn't /sprites/<kind>.png.
export const COLONIST_STATIC_URL_OVERRIDES: Partial<Record<ColonistKind, string>> = {
  hunter: "/sprites/archer.png",
  forager: "/sprites/farmhand.png",
  builder: "/sprites/lumberjack.png",
  cavalry: "/sprites/player.png",
  batteringRam: "/sprites/cart.png",
  catapult: "/sprites/crate.png",
  wagon: "/sprites/cart.png",
};
// Player (mounted knight): walk + 2-frame lance attack, idle = walk frame 0. The walk row carries
// the banner, the attack row doesn't; both canvases are centered on the horse's body (not the
// banner/lance), so the feet-pinned swap between rows doesn't hop. playerIdle.png (the banner-only
// standing frame) is staged on disk but unused, per the idle = walk-frame-0 convention.
export const PLAYER_ANIM_URLS = { walk: frameUrls("playerWalk", 4), action: frameUrls("playerAttack", 2) };
// Server colonist states that play the action cycle / the walk cycle. Any other state walks only
// while the colonist is actually moving (e.g. civilians sheltering), else shows the static pose.
export const COLONIST_ACTION_STATES = new Set([
  "attacking",
  "gathering",
  "mining",
  "farming",
  "crafting",
  "healing",
  "warding",
  "hunting",
  "foraging",
  "building",
  "repairing",
]);
export const COLONIST_WALK_STATES = new Set([
  "engaging",
  "returning",
  "toResource",
  "toPost",
  "approaching",
  "patrolling",
  "stalking",
  "collecting",
  "carrying",
  "toForage",
  "toRepair",
]);
// Hunter/forager states that count as "working" in the Colony panel (out on the job, not idle at the hut).
export const FOOD_WORKER_BUSY_STATES = new Set(["stalking", "hunting", "collecting", "carrying", "toForage", "foraging"]);

// Animated and/or multi-look mob kinds. A kind with several entries picks one per mob by a stable
// hash of its id. `idle` is the standing pose (defaults to the first walk frame).
export interface MobVariantUrls {
  idle?: string;
  walk?: string[];
  action?: string[];
}
export const MOB_VARIANT_URLS: Partial<Record<MobKind, MobVariantUrls[]>> = {
  banditClubman: [{ walk: frameUrls("banditClubmanWalk", 5), action: frameUrls("banditClubmanAttack", 4) }],
  // The source sheet's "archer walk" row starts with two club-holding frames and its attack row
  // has a spear-throw in the middle, so this only uses its bow-holding frames.
  banditArcher: [
    {
      walk: ["/sprites/banditArcherWalk2.png", "/sprites/banditArcherAttack0.png"],
      action: [
        "/sprites/banditArcherAttack0.png",
        "/sprites/banditArcherWalk3.png",
        "/sprites/banditArcherAttack2.png",
      ],
    },
  ],
  banditElite: [
    { idle: "/sprites/bandit.png", walk: frameUrls("banditWalk", 4), action: frameUrls("banditAttack", 3) },
  ],
  halfLatch: frameUrls("halfLatch", 5).map((idle) => ({ idle })),
  // Forts phase C: human settlement folk borrow the colonist sets (tinted by MOB_TINT).
  townGuard: [{ walk: frameUrls("militiaWalk", 4), action: frameUrls("militiaAttack", 3) }],
  townArcher: [{ walk: frameUrls("archerWalk", 4), action: frameUrls("archerAttack", 6) }],
  townKnight: [{ walk: frameUrls("knightWalk", 4), action: frameUrls("knightAttack", 4) }],
  townFarmer: [{ walk: frameUrls("farmerWalk", 4), action: frameUrls("farmerHarvest", 3) }],
  townMiner: [{ walk: frameUrls("ironMinerWalk", 4), action: frameUrls("ironMinerMine", 3) }],
  townPriest: [{ walk: frameUrls("bishopWalk", 4), action: frameUrls("bishopHeal", 3) }],
  // The monster roster: one look each, 4 walk + 3 attack frames, idle = walk frame 0. The static
  // /sprites/<kind>.png stays as the fallback texture only.
  goblin: [{ walk: frameUrls("goblinWalk", 4), action: frameUrls("goblinAttack", 3) }],
  wolf: [{ walk: frameUrls("wolfWalk", 4), action: frameUrls("wolfAttack", 3) }],
  goblinCrossbow: [{ walk: frameUrls("goblinCrossbowWalk", 4), action: frameUrls("goblinCrossbowAttack", 3) }],
  orc: [{ walk: frameUrls("orcWalk", 4), action: frameUrls("orcAttack", 3) }],
  skeleton: [{ walk: frameUrls("skeletonWalk", 4), action: frameUrls("skeletonAttack", 3) }],
  armoredOrc: [{ walk: frameUrls("armoredOrcWalk", 4), action: frameUrls("armoredOrcAttack", 3) }],
  giantSpider: [{ walk: frameUrls("giantSpiderWalk", 4), action: frameUrls("giantSpiderAttack", 3) }],
  darkShaman: [{ walk: frameUrls("darkShamanWalk", 4), action: frameUrls("darkShamanAttack", 3) }],
  troll: [{ walk: frameUrls("trollWalk", 4), action: frameUrls("trollAttack", 3) }],
  ogre: [{ walk: frameUrls("ogreWalk", 4), action: frameUrls("ogreAttack", 3) }],
  // Stand-in (tinted, MOB_TINT) until goblinRider* loads (MOB_OPTIONAL_VARIANT_URLS).
  goblinRider: [{ walk: frameUrls("wolfWalk", 4), action: frameUrls("wolfAttack", 3) }],
};
// Animated looks loaded optionally (loadOptionalTextures): when every frame loads, the set replaces the
// kind's static, tinted stand-in (MOB_SPRITE_URL_OVERRIDES / MOB_TINT). The raiders' siege engines
// (SPRITES.md #40/#41): the ram's move row has only two clean frames on the source sheet.
export const MOB_OPTIONAL_VARIANT_URLS: Partial<Record<MobKind, { walk: string[]; action: string[] }>> = {
  batteringRam: { walk: frameUrls("mobBatteringRamWalk", 2), action: frameUrls("mobBatteringRamAttack", 3) },
  catapult: { walk: frameUrls("mobCatapultWalk", 4), action: [...frameUrls("mobCatapultLoad", 3), ...frameUrls("mobCatapultFire", 3)] },
  // Goblin wolf rider (SPRITES.md #83).
  goblinRider: { walk: frameUrls("goblinRiderWalk", 4), action: frameUrls("goblinRiderAttack", 3) },
};
// Batch 2 (SPRITES.md #83): veteran wolf riders (darker fur, bone trophies) for Hunger-marked riders, only
// with the base set loaded. The sheet has no veteran attack row: VetAttack is its levelled-spear charge row.
export const GOBLIN_RIDER_VET_URLS = { walk: frameUrls("goblinRiderVetWalk", 4), action: frameUrls("goblinRiderVetAttack", 3) };
// The Ogre Warlord boss (an ogre with boss "warlord"; SPRITES.md #15), loaded optionally: without it the
// boss stays the plain ogre set drawn BOSS_RENDER_SCALE larger. Walk / attack as usual; standing still it
// shows `idle`, and plays its `roar` when first seen and then every WARLORD_ROAR_EVERY_MS while idle.
export const WARLORD_URLS = {
  walk: frameUrls("ogreWarlordWalk", 4),
  action: frameUrls("ogreWarlordAttack", 3),
  roar: frameUrls("ogreWarlordRoar", 3),
  idle: "/sprites/ogreWarlordIdle.png",
};
// Rendered walk-canvas height before BOSS_RENDER_SCALE. The canvas is 265px, the body (crown to feet,
// without the banner pole) 210px of it, so 64 puts the body at the ogre's ~51px, i.e. ~82px as the boss.
export const WARLORD_ANIM_SIZE = 64;
export const WARLORD_ROAR_FRAME_MS = 260;
export const WARLORD_ROAR_EVERY_MS = 9000;
// Wide, low kinds whose anim set is sized by the first walk frame's longer side (its width), like
// the static mob textures (upsertMob), so they don't balloon horizontally. Every other animated
// kind fits by height: a walk canvas is widened symmetrically around the body's centroid to fit
// each frame's weapon reach, so its width overstates an upright body and a longer-side fit would
// shrink orcs/crossbowmen ~15% below their static size.
export const MOB_ANIM_FIT_LONGER_SIDE = new Set<MobKind>(["wolf", "giantSpider", "goblinRider"]);
// A stationary mob within this distance of a colonist/player plays its attack cycle (mob snapshots
// carry no state, so this is inferred client-side).
export const MOB_ATTACK_ANIM_RANGE_PX = 40;
// Ranged kinds stand off at their server attack range (banditArcher/goblinCrossbow: TILE_SIZE * 4,
// darkShaman: TILE_SIZE * 5), plus slack.
export const MOB_ATTACK_ANIM_RANGE_OVERRIDES_PX: Partial<Record<MobKind, number>> = {
  banditArcher: TILE_SIZE * 4 + 16,
  goblinCrossbow: TILE_SIZE * 4 + 16,
  darkShaman: TILE_SIZE * 5 + 16,
  // Server CATAPULT_RANGE.
  catapult: TILE_SIZE * 11 + 16,
};

export function stableHash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}
// Same ratio colonists use: their r=8 fallback circle maps to the 28px COLONIST_SPRITE_HEIGHT.
// Goblin (r7) -> ~24px, ogre (r15) -> ~52px.
export const MOB_SPRITE_SIZE_PER_RADIUS = 3.5;

export function mobHitRadius(kind: MobKind, scale = 1): number {
  const radius = (MOB_VISUALS[kind] ?? MOB_VISUALS.goblin).radius;
  return Math.max(MOB_HIT_RADIUS, (radius * MOB_SPRITE_SIZE_PER_RADIUS * scale) / 2);
}
