// Solo hero (docs/colony2d/PLAN-solo-hero.md; ROADMAP "Solo hero — landed"): the data the server and client share
// for the playable hero: pack goods and carry weight, needs, skills by use, gather sources, personal builds and the
// role dialogue trees. Server: server/src/herolife.ts. Client: client/src/herolife.ts.
import { TileType, type RelationTier } from "./protocol.js";
import { type ItemId, WORKER_XP_LEVELS } from "./progression.js";

// ---- pack (carried goods) ----
export type PackGood = "wood" | "rock" | "iron" | "grain" | "meat" | "fruit" | "fish";
export const PACK_GOODS: PackGood[] = ["wood", "rock", "iron", "grain", "meat", "fruit", "fish"];
export const PACK_LABEL: Record<PackGood, string> = {
  wood: "Wood", rock: "Stone", iron: "Iron ore", grain: "Grain", meat: "Meat", fruit: "Fruit", fish: "Fish",
};
export const PACK_WEIGHT: Record<PackGood, number> = { wood: 1, rock: 2, iron: 2, grain: 0.5, meat: 0.5, fruit: 0.5, fish: 0.5 };
// Carry capacity (weight units). Over half full the hero slows down, to x0.75 when full; full = no more gathering.
export const PACK_CAP = 40;
// Food value of one unit eaten from the pack (needs are 0-100).
export const PACK_FOOD: Partial<Record<PackGood, number>> = { meat: 25, fish: 22, fruit: 15, grain: 10 };

// ---- needs (mild: they slow you down and block healing, never kill) ----
export const NEED_MAX = 100;
// Below this a need is "low": x0.8 move speed each and no natural healing.
export const NEED_LOW = 25;
// The pack is eaten from automatically below this.
export const AUTO_EAT_BELOW = 50;

// ---- skills (by use; same XP pace and levels as settlement workers: WORKER_XP_LEVELS) ----
export type HeroSkill =
  | "woodcutting" | "mining" | "foraging" | "fishing" | "farming" | "hunting" | "building"
  | "smithing" | "smelting" | "charcoal" | "milling" | "baking" | "trading" | "speech";
export const HERO_SKILLS: HeroSkill[] = [
  "woodcutting", "mining", "foraging", "fishing", "farming", "hunting", "building",
  "smithing", "smelting", "charcoal", "milling", "baking", "trading", "speech",
];
export const HERO_SKILL_LABEL: Record<HeroSkill, string> = {
  woodcutting: "Woodcutting", mining: "Mining", foraging: "Foraging", fishing: "Fishing", farming: "Farming",
  hunting: "Hunting", building: "Building", smithing: "Smithing", smelting: "Smelting", charcoal: "Charcoal burning",
  milling: "Milling", baking: "Baking", trading: "Trading", speech: "Speech",
};
// Station the hero can work (as the worker) -> the skill it levels. Only stations with station recipes produce.
export const STATION_SKILL: Partial<Record<TileType, HeroSkill>> = {
  [TileType.CharcoalBurner]: "charcoal",
  [TileType.Bloomery]: "smelting",
  [TileType.Mill]: "milling",
  [TileType.Bakery]: "baking",
};
// Masters teach up to this level for coin (MASTER_FEE per level gained).
export const MASTER_MAX_LEVEL = 2;
export const MASTER_FEE = 30;
export function skillXpFor(level: number): number {
  return WORKER_XP_LEVELS[Math.max(0, Math.min(WORKER_XP_LEVELS.length - 1, level - 1))];
}
// +25% speed per skill level above 1 (the worker tier rule).
export function skillSpeed(level: number): number {
  return 1 + 0.25 * Math.max(0, level - 1);
}

// ---- gathering (hold E next to the source) ----
export type GatherKind = "chop" | "mine" | "quarry" | "forage" | "fish";
export interface GatherDef {
  label: string;
  skill: HeroSkill;
  good: PackGood;
  amount: number;
  seconds: number;
  // A clan item that must be in the clan's store (the progression tool gates); none = bare hands.
  tool?: ItemId;
}
export const GATHER: Record<GatherKind, GatherDef> = {
  chop: { label: "Chopping", skill: "woodcutting", good: "wood", amount: 2, seconds: 3, tool: "stoneAxe" },
  quarry: { label: "Quarrying", skill: "mining", good: "rock", amount: 1, seconds: 3, tool: "stonePick" },
  mine: { label: "Mining ore", skill: "mining", good: "iron", amount: 1, seconds: 4, tool: "stonePick" },
  forage: { label: "Foraging", skill: "foraging", good: "fruit", amount: 2, seconds: 2 },
  fish: { label: "Fishing", skill: "fishing", good: "fish", amount: 1, seconds: 5 },
};
export function gatherKindOf(tile: TileType, ripeForage: boolean): GatherKind | null {
  if (tile === TileType.Tree) return "chop";
  if (tile === TileType.Rock) return "quarry";
  if (tile === TileType.IronOre) return "mine";
  if (tile === TileType.Water) return "fish";
  if (ripeForage) return "forage";
  return null;
}
// Chance a chopped tree falls (the tile clears) on each yield.
export const TREE_FELL_CHANCE = 0.25;

// ---- personal builds (by hand, next to the hero) ----
export type PersonalBuild = "campfire" | "leanTo" | "chest";
export interface PersonalBuildDef {
  label: string;
  desc: string;
  tile: TileType;
  cost: Partial<Record<PackGood, number>>;
}
export const PERSONAL_BUILDS: Record<PersonalBuild, PersonalBuildDef> = {
  campfire: { label: "Campfire", desc: "Rest twice as fast within 3 tiles; cook nothing yet.", tile: TileType.PropCampfire, cost: { wood: 5, rock: 2 } },
  leanTo: { label: "Lean-to", desc: "A rough shelter: rest three times as fast within 2 tiles.", tile: TileType.Tent, cost: { wood: 12 } },
  chest: { label: "Storage chest", desc: "Deposit your pack into your stores here.", tile: TileType.PropCrate, cost: { wood: 8 } },
};
export const PERSONAL_BUILD_MAX = 6;

// ---- dialogue ----
export type NpcRole = "leader" | "trader" | "villager" | "questGiver" | "folk";
export type DialogueAction =
  | "bye" | "trade" | "sellPack" | "askWork" | "quests" | "gift" | "rumour" | "alliance" | "train" | "fare" | "lodging";
export interface DialogueChoiceDef {
  label: string;
  next?: string;
  action?: DialogueAction;
  // Shown only at these relation tiers (missing: always).
  tiers?: RelationTier[];
}
export interface DialogueNodeDef {
  // By relation tier, else `default`. {npc} {site} {tier} are filled in.
  text: Partial<Record<RelationTier | "default", string>>;
  choices: DialogueChoiceDef[];
}
const NOT_HOSTILE: RelationTier[] = ["wary", "neutral", "friendly", "allied", "vassal"];
const TRADING: RelationTier[] = ["neutral", "friendly", "allied", "vassal"];
const BYE: DialogueChoiceDef = { label: "Farewell.", action: "bye" };
export const DIALOGUE: Record<NpcRole, Record<string, DialogueNodeDef>> = {
  leader: {
    start: {
      text: {
        hostile: "{npc} glares at you. \"You have some nerve, walking into {site}.\"",
        wary: "{npc} looks you over. \"State your business in {site}, stranger.\"",
        neutral: "\"Welcome to {site}. I am {npc}. What brings you here?\"",
        friendly: "\"Ah, a friend of {site}! Sit, sit. What do you need?\"",
        allied: "{npc} clasps your arm. \"Our ally! {site}'s gates are always open to you.\"",
        vassal: "{npc} bows. \"My liege. {site} is at your service.\"",
      },
      choices: [
        { label: "Let's trade.", action: "trade", tiers: TRADING },
        { label: "Do you need help with anything?", action: "askWork", tiers: NOT_HOSTILE },
        { label: "A gift for {site} (20 gold).", action: "gift" },
        { label: "Who could teach me a trade?", action: "train", tiers: TRADING },
        { label: "Let us stand together: an alliance.", action: "alliance", tiers: ["friendly"] },
        BYE,
      ],
    },
  },
  trader: {
    start: {
      text: {
        hostile: "\"I sell nothing to your kind.\"",
        wary: "\"Coin first, questions never. And not today.\"",
        default: "{npc} spreads out a cloth of wares. \"Buying or selling?\"",
      },
      choices: [
        { label: "Show me your goods.", action: "trade", tiers: TRADING },
        { label: "Buy what I carry.", action: "sellPack", tiers: TRADING },
        { label: "Heard anything on the road?", action: "rumour", tiers: NOT_HOSTILE },
        BYE,
      ],
    },
  },
  villager: {
    start: {
      text: {
        hostile: "The villager backs away from you.",
        default: "\"Fair day to you. I'm {npc}, of {site}.\"",
      },
      choices: [
        { label: "Any news around here?", action: "rumour", tiers: NOT_HOSTILE },
        { label: "Who is in charge here?", next: "chief", tiers: NOT_HOSTILE },
        { label: "Could I rest here a while?", action: "lodging", tiers: ["friendly", "allied", "vassal"] },
        BYE,
      ],
    },
    chief: {
      text: { default: "\"Talk to the elder up at the keep. They hand out the work, and the coin.\"" },
      choices: [{ label: "Thanks. Anything else?", next: "start" }, BYE],
    },
  },
  questGiver: {
    start: {
      text: {
        hostile: "The priest makes a warding sign at you and turns away.",
        default: "{npc} folds their hands. \"{site} has troubles, traveller. Will you hear them?\"",
      },
      choices: [
        { label: "What needs doing?", action: "quests", tiers: NOT_HOSTILE },
        { label: "Is there more work?", action: "askWork", tiers: NOT_HOSTILE },
        { label: "Any word of danger nearby?", action: "rumour", tiers: NOT_HOSTILE },
        BYE,
      ],
    },
  },
  // One of your own people.
  folk: {
    start: {
      text: { default: "{npc} looks up from their work. \"Yes?\"" },
      choices: [{ label: "How do you fare?", action: "fare" }, BYE],
    },
  },
};
export const NPC_ROLE_LABEL: Record<NpcRole, string> = {
  leader: "Elder", trader: "Trader", villager: "Villager", questGiver: "Priest", folk: "Your people",
};
// Gift: gold, the relation it buys and one gift per settlement per game day.
export const GIFT_GOLD = 20;
export const GIFT_RELATION = 3;
// Alliance: asked at Friendly; succeeds at relation >= ALLIANCE_ASK_MIN - 5 x speech level.
export const ALLIANCE_ASK_MIN = 50;
// Talk range (tiles) to an NPC (the keep for a leader).
export const TALK_RANGE_TILES = 2.5;

// ---- wire ----
// Per-player snapshot field `life` (only when it changed).
export interface HeroLifeSnapshot {
  pack: Partial<Record<PackGood, number>>;
  weight: number;
  cap: number;
  food: number;
  rest: number;
  // false: needs are off (creative, older test suites).
  needs: boolean;
  skills: { id: HeroSkill; level: number; xp: number; next: number | null }[];
  // Hold-E progress (0-1) and what is being done.
  gather?: { label: string; p: number };
  work?: { label: string; p: number };
  resting?: boolean;
  // Why the hero is slow / not healing ("Hungry", "Tired", "Heavy load").
  slow?: string[];
  builds: number;
}
export interface DialogueSnapshot {
  npc: { name: string; role: NpcRole; roleLabel: string; site?: string; tier?: RelationTier; color: number };
  text: string;
  choices: { label: string; disabled?: string }[];
}
export type HeroActionKind = "eat" | "rest" | "deposit" | "build" | "stopWork";

// Save / load: a HeroLife from untrusted saved data (null: none / malformed). Kept here (pure) so heroes.ts restores
// it without importing the server module.
export interface HeroLifeData {
  pack: Partial<Record<PackGood, number>>;
  food: number;
  rest: number;
  skills: Partial<Record<HeroSkill, number>>;
  flags: Record<string, number>;
  builds: { kind: PersonalBuild; x: number; y: number }[];
}
export function sanitizeHeroLife(raw: unknown): HeroLifeData | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  const pack: Partial<Record<PackGood, number>> = {};
  for (const g of PACK_GOODS) {
    const v = num((r.pack as Record<string, unknown> | undefined)?.[g], 0, 9999, 0);
    if (v > 0) pack[g] = Math.floor(v);
  }
  const skills: Partial<Record<HeroSkill, number>> = {};
  for (const k of HERO_SKILLS) {
    const v = num((r.skills as Record<string, unknown> | undefined)?.[k], 0, 1e6, 0);
    if (v > 0) skills[k] = v;
  }
  const flags: Record<string, number> = {};
  if (r.flags && typeof r.flags === "object") {
    for (const [k, v] of Object.entries(r.flags as Record<string, unknown>)) if (typeof v === "number" && Number.isFinite(v) && k.length < 80) flags[k] = v;
  }
  const builds = Array.isArray(r.builds)
    ? (r.builds as Record<string, unknown>[]).filter((b) => b && (b.kind as string) in PERSONAL_BUILDS && Number.isInteger(b.x) && Number.isInteger(b.y))
        .slice(0, PERSONAL_BUILD_MAX).map((b) => ({ kind: b.kind as PersonalBuild, x: b.x as number, y: b.y as number }))
    : [];
  return { pack, food: num(r.food, 0, NEED_MAX, NEED_MAX), rest: num(r.rest, 0, NEED_MAX, NEED_MAX), skills, flags, builds };
}
