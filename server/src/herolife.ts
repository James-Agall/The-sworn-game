import { holdTownSpeaker, releaseTownSpeaker } from "./townLife.js";
import { treeAt } from "@colony/shared/trees";
// herolife.ts: Solo hero phases 1-3 (docs PLAN-solo-hero.md; ROADMAP "Solo hero — landed"). The playable hero as a
// participant: E-interact (talk to NPCs: settlement elders, traders, villagers, priests, your own people; gather from
// trees / rock / ore / forage / water; work an own recipe station as its worker), data-driven role dialogue
// (shared/src/herolife.ts DIALOGUE) wired to relations, trade, quests, gifts, rumours, alliances and masters; the
// hero's pack (carry weight), mild needs (food + rest slow you and block healing, never kill), skills by use (worker
// XP pace), personal builds (campfire, lean-to, storage chest). State: HeroProfile.life (saved with the profile);
// per-session transient work lives here. Messages run in the sender's clan context (index.ts handleMessage).
import { animalsForSale, dismountHero, heroAnimalInteract, heroHandProduct, isMounted, sellAnimalTo } from "./animals.js";
import { MOUNT_REST_DECAY_MULT, MOUNT_SPEED_MULT } from "@colony/shared/animals";
import { heroInfirmaryHealMult, heroRestMultAt, roomAtIndex, warmRoomAt } from "./structures.js";
import { TICK_RATE, TILE_SIZE, TileType, TRADE_GOODS, type TradeGood, type RelationTier } from "@colony/shared/protocol";
import {
  ALLIANCE_ASK_MIN, AUTO_EAT_BELOW, BRIDE_GIFT_GOLD, CEREMONY_FEE, COURT_GIFT_GOLD, COURT_NEEDED, FOUND_CAMP_COST, DIALOGUE, GATHER, GIFT_GOLD, GIFT_RELATION, HERO_SKILLS, HERO_SKILL_LABEL,
  MASTER_FEE, MASTER_MAX_LEVEL, NEED_LOW, NEED_MAX, NPC_ROLE_LABEL, PACK_CAP, PACK_FOOD, PACK_GOODS, PACK_LABEL,
  PACK_WEIGHT, PERSONAL_BUILDS, PERSONAL_BUILD_MAX, STATION_SKILL, TALK_RANGE_TILES,
  ENERGY_COST, ENERGY_EMPTY_SPEED, ENERGY_MAX, ENERGY_PER_FOOD, ENERGY_REST_PER_S, HAND_HARVEST_SECONDS, HERO_TOOLS, HERO_TOOL_ITEM,
  SEED_ITEM, TOOL_ACT_LABEL, TOOL_SECONDS, WATER_CAN_CHARGES, HERALD_LINES, kinGreeting,
  type DialogueAction, type DialogueSnapshot, type GatherKind, type HeroLifeSnapshot, type HeroSkill, type HeroTool, type NpcRole,
  type PackGood, type PersonalBuild, type ToolAct, gatherKindOf, skillSpeed, skillXpFor,
} from "@colony/shared/herolife";
import { TAVERN_DRINKS_PER_DAY, TAVERN_DRINK_CHEER_TICKS, TAVERN_DRINK_GOLD, TAVERN_DRINK_HAPPINESS, TAVERN_DRINK_REST, INN_REST_FOOD, INN_REST_GOLD, INN_RUMOUR_GOLD } from "@colony/shared/interiors";
import { CROPS, CropStage, type CropId } from "@colony/shared/zones";
import { heroCropStage, heroFarmApply, heroFarmCheck, heroFertilise, heroZoneCrop } from "./zones.js";
import { type ItemId, type Recipe, PROGRESSION, PROFESSION_LABEL, levelForXp, outputCap, smithLevelForGearTier, stationRecipes, xpToNext } from "@colony/shared/progression";
import { MINE_HERO_DIG_AMOUNT, MINE_HERO_DIG_SECONDS, isLayeredMine } from "@colony/shared/mines";
import {storyOnMeet,storyOffers,storyDialogue,storyEvent,sendJournal} from './story.js';
import {STORY_RECIPES} from '@colony/shared/stories';
import {handleInteriorObjectChoice} from "./interiors.js";
import {grantStoryShield} from './heroes.js';
import {specialCharacterDefeated} from "./mines.js";
import {SPECIAL_BY_ID} from "@colony/shared/specialCast";
import {specialAddress} from "./specialCast.js";
import { mineDigBlock, mineDigRows, mineHeroCaveIn, mineHeroDigSpeed } from "./mines.js";
import type { ResourceKey, Colonist, HeroLife, Mob, Player, SiteState } from "./types.js";
import { CRAFT_RECIPES, FORGE_TICKS, FORAGE_RIPE_TO_PICKED, FORAGE_REGROW_TICKS, QUEST_MAX_PER_SITE, RELATION_ALLIED_MIN } from "./constants.js";
import { colonists, forageRegrow, hearths, mobs, players, sites, state } from "./state.js";
import { anchorOfTile, getBuildingLevel, inBounds, isNightNow, ownerAt, tileIndex } from "./tiles.js";
import { isWalkableTile } from "./pathfinding.js";
import { resolveTownCenterPlacement } from "./construction.js";
import { newPerson, spawnVillager } from "./colonists.js";
import { setTile, tileIndicesOf } from "./chunks.js";
import { chopTree, treeChopsDone } from "./economy.js";
import { broadcastTileUpdate, circleOffsets, revealAround } from "./net.js";
import { sendTo } from "./saves.js";
import { clanIdAt, clanOf, clanTownCenters, townCentersOfClan, withClan } from "./clans.js";
import { gameDay, handleTradeWithSite, standingTown, tierOf, tilesToWalls } from "./diplomacy.js";
import { adjustRelation, relationOf } from "./sites.js";
import { boardQuestsFor, campNear, forcePostQuest, handleQuestMessage, postRoleQuest, quests, questsForSnapshot } from "./quests.js";
import {
  CAPTAIN_SCOUT_RANGE_TILES, NAMED_ROLE_PLACE, ROLE_FAVOUR_NEEDED, ROLE_PERKS, ROLE_QUESTS, ROLE_REMEMBERS, SMITH_FAVOUR_TOOLS,
  TRADER_FAVOUR_GOODS, nameFor as sharedNameFor, nameHash, namedRoleName, type NamedRole, type QuestRole,
} from "@colony/shared/namedRoles";
import { addItem, bronzeToolMult, produceItem, gatesOpen, itemCount, professionOf, recipeReady, stationIdleReason, takeItem, workerLevel } from "./progression.js";
import { forgeCost, forgedTier, forgeItems, heroProfileOf, playerMaxHp } from "./heroes.js";
import {
  bringKinHome, cachedFamilySnapshot, childrenOf, courtable, familyOf, familySnapshot, heroTaken, kinBond, kinRelation, marry, partWays, resetFamilyCache,
} from "./family.js";
import { handleCallToArms } from "./vassals.js";
import { heirOrderNames } from "./people.js";
import { calendarNow, cropGrowthMult, seasonsOn, weatherNow, winterNow } from "./calendar.js";
import { villagerTokens } from "@colony/shared/villagerTalk";
import type { BuildingType } from "@colony/shared/buildingTemplates";
import { buildingTemplateById } from "./buildingTemplates.js";
import { cropSeasonLabel, WINTER_COLD_REST_DECAY_MULT, WINTER_COLD_REST_GAIN_MULT, WINTER_WARM_ROOM_REST_MULT } from "@colony/shared/calendar";
import {interiorWorkstation, ownInterior, sharedStockAccess, tryWorldChest,worldChestChoice,interiorFurnitureChoice, interiorInteract, interiorRestMult, tryEnterAtDoor } from "./interiors.js";
import { settlementTemplateById } from "./settlementTemplates.js";
import { spawnMobAt } from "./creative.js";
import { refreshGoalSnapshot } from "./goals.js";
import { SOLO_SCOUT_DIST_TILES, SOLO_SCOUT_FIRST_DAY, SOLO_SCOUT_KIND } from "@colony/shared/herolife";
import { heroCold, heroColdRestGain, heroColdSpeedMult, heroColdWorkMult } from "./winter.js";

// ---- profile state ----
export function lifeOf(player: Player): HeroLife {
  const prof = heroProfileOf(player);
  return (prof.life ??= { pack: {}, food: NEED_MAX, rest: NEED_MAX, skills: {}, flags: {}, builds: [] });
}

export function skillLevel(life: HeroLife, s: HeroSkill): number {
  return levelForXp(life.skills[s] ?? 0);
}

// XP by use (one point a second of work, the worker pace); a level-up toasts.
export function gainSkill(player: Player, s: HeroSkill, xp: number) {
  if (xp <= 0) return;
  const life = lifeOf(player);
  const before = skillLevel(life, s);
  life.skills[s] = (life.skills[s] ?? 0) + xp;
  const after = skillLevel(life, s);
  if (after > before) sendTo(player, { type: "event", category: "milestone", text: `${HERO_SKILL_LABEL[s]} is now level ${after}` });
}

export function packWeight(life: HeroLife): number {
  let w = 0;
  for (const g of PACK_GOODS) w += (life.pack[g] ?? 0) * PACK_WEIGHT[g];
  return Math.round(w * 10) / 10;
}

// Test hook override (null: needs are on in normal games, off in creative and with COLONY_UNLOCK_ALL).
let needsOverride: boolean | null = null;
export function setNeedsOverride(v: boolean | null) {
  needsOverride = v;
}
export function needsOn(): boolean {
  return needsOverride ?? (!state.creative && !state.testUnlockAll);
}

// Stardew phase 5a: energy (stamina; missing = full) and the watering can's charges (missing = full).
export const energyOf = (life: HeroLife) => life.energy ?? ENERGY_MAX;
const waterOf = (life: HeroLife) => life.water ?? WATER_CAN_CHARGES;
function addEnergy(life: HeroLife, d: number) {
  life.energy = Math.max(0, Math.min(ENERGY_MAX, energyOf(life) + d));
}
// Work speed from energy: half at 0 (never blocked; off with needs).
const energySpeed = (life: HeroLife) => (needsOn() && energyOf(life) <= 0 ? ENERGY_EMPTY_SPEED : 1);
function spendEnergy(life: HeroLife, n: number) {
  if (needsOn() && n > 0) addEnergy(life, -n);
}

// ---- per-session transient state ----
interface GatherJob {
  tx: number;
  ty: number;
  kind: GatherKind;
  left: number;
  total: number;
  // A tool use (Space / click): one yield, then stop.
  once?: boolean;
}
// Stardew phase 5a: one tool use on a tile (till / sow / water / refill / harvest).
interface ToolJob {
  tx: number;
  ty: number;
  act: ToolAct;
  crop: CropId;
  left: number;
  total: number;
}
interface WorkJob {
  tx: number;
  ty: number;
  tile: TileType;
  skill: HeroSkill;
  job?: { recipe: PersonalRecipe; left: number; total: number };
  insideKey?: string;
  idle?: string;
}
export interface ChoiceRt {
  label: string;
  disabled?: string;
  next?: string;
  action?: DialogueAction | "accept" | "deliver" | "learn" | "back" | "pick" | "sellAnimal" | "worldChestPut" | "worldChestTake";
  arg?: number | string;
}
// Stardew phase 5c: a talk inside a building interior (the NPC / bed / chest stands at interior px x / y of the
// interior `key`; range is measured there) and the building it is in (openBuilding).
export interface TalkInside {
  world?:boolean;
  key: string;
  x: number;
  y: number;
  anchor: { x: number; y: number };
  // Gap closure G5: inside a tavern (keepers / traders there also sell a drink).
  tavern?: boolean;
}
interface Talk {
  specialId?: string;
  role: NpcRole;
  name: string;
  siteId?: string;
  colonistId?: string;
  mobId?: string;
  color: number;
  choices: ChoiceRt[];
  inside?: TalkInside;
  // Phase 6: the people offered by the "who do you speak to?" chooser.
  picks?: Target[];
  // Named roles: the quest list shown last was this person's own (accept / deliver re-show it).
  listGiver?: QuestRole;
}
interface Busy {
  gather?: GatherJob;
  tool?: ToolJob;
  work?: WorkJob;
  resting?: boolean;
  talk?: Talk;
  hurtTick: number;
  lastHp: number;
  sent: string;
}
const busy = new Map<string, Busy>();
function busyOf(p: Player): Busy {
  let b = busy.get(p.id);
  if (!b) busy.set(p.id, (b = { hurtTick: -1e9, lastHp: p.hp, sent: "" }));
  return b;
}

export const toast = (p: Player, text: string) => sendTo(p, { type: "event", category: "build", text });
const tileCenterDist = (p: Player, tx: number, ty: number) => Math.hypot((tx + 0.5) * TILE_SIZE - p.x, (ty + 0.5) * TILE_SIZE - p.y) / TILE_SIZE;

// ---- names (stable per NPC id) ----
// (The name pool and hash live in shared/src/namedRoles.ts, so a named person is named the same everywhere.)
const hashOf = nameHash;
export const nameFor = sharedNameFor;
export const talkColorFor = (name: string) => [0xc9a227, 0x6aa84f, 0x8e7cc3, 0xe69138, 0x3d85c6][hashOf(name) % 5];

// ---- talk ----
export interface Target {
  specialId?: string;
  role: NpcRole;
  name: string;
  d: number;
  site?: SiteState;
  mob?: Mob;
  colonist?: Colonist;
  inside?: TalkInside;
}
// Phase 6: everyone in talking range, nearest first. The Elder is measured to the keep tile's edge (the keep is one
// tile), every NPC / villager to its body, so a priest standing at the keep answers when it is the nearer one.
const TALK_TIE_TILES = 0.35;
function talkTargets(p: Player): Target[] {
  const out: Target[] = [];
  const offer = (t: Target) => {
    if (t.d <= TALK_RANGE_TILES) out.push(t);
  };
  for (const s of sites.values()) {
    if (!standingTown(s)) continue;
    offer({ role: "leader", name: `Elder ${nameFor(s.id)}`, d: Math.max(0, tileCenterDist(p, s.keepX, s.keepY) - 0.5), site: s });
  }
  for (const m of mobs.values()) {
    if (!m.siteWorker || !m.siteId) continue;
    const s = sites.get(m.siteId);
    if (!standingTown(s)) continue;
    const role: NpcRole = m.siteWorker === "priest" ? "questGiver" : m.siteWorker === "herald" ? "herald" : s.workers[0] === m.id ? "trader" : "villager";
    // Named roles: the merchant and the priest are the settlement's named people (the same name indoors).
    const name = role === "herald" ? `${heraldLines(s).title} ${nameFor(`${s.id}:herald`)}`
      : role === "questGiver" ? namedRoleName(s.id, "priest") : role === "trader" ? namedRoleName(s.id, "trader") : nameFor(m.id);
    offer({ role, name, d: Math.hypot(m.x - p.x, m.y - p.y) / TILE_SIZE, site: s, mob: m });
  }
  // Named roles: the captain of the watch (a guard of the garrison, while it stands at ease).
  for (const s of sites.values()) {
    if (!standingTown(s)) continue;
    const m = captainOf(s);
    if (m && !m.guardianActive) offer({ role: "captain", name: namedRoleName(s.id, "captain"), d: Math.hypot(m.x - p.x, m.y - p.y) / TILE_SIZE, site: s, mob: m });
  }
  for (const c of colonists.values()) {
    if (!c.person || c.person.child || (c.clan ?? 0) !== p.clan || c.hp <= 0) continue;
    offer({ role: "folk", name: c.person.name, d: Math.hypot(c.x - p.x, c.y - p.y) / TILE_SIZE, colonist: c });
  }
  return out.sort((a, b) => a.d - b.d);
}

// Two or more people about equally near: ask which one (the choice opens a talk with that one).
function startTalkChooser(p: Player, ts: Target[]) {
  const first = ts[0];
  const t: Talk = {
    role: first.role, name: first.name, siteId: first.site?.id, mobId: first.mob?.id, colonistId: first.colonist?.id,
    color: talkColorFor(first.name), choices: [], picks: ts,
  };
  t.choices = [...ts.map((x, i) => ({ label: `Speak to ${x.name}.`, action: "pick" as const, arg: i })), { label: "Never mind.", action: "bye" }];
  busyOf(p).talk = t;
  sendTalk(p, t, "Who do you speak to?");
}

// Gap closure G7: the quest giver's lines by its settlement's tier (hamlet reeve / village bailiff / town herald).
export function heraldLines(s: SiteState | undefined): (typeof HERALD_LINES)[1] {
  const tier = (s?.layout ? settlementTemplateById(s.layout)?.tier : undefined) ?? 2;
  return HERALD_LINES[Math.max(1, Math.min(3, tier)) as 1 | 2 | 3];
}

function fill(text: string, t: Talk, tier?: RelationTier, clan = 0, p?: Player): string {
  const s = t.siteId ? sites.get(t.siteId) : undefined;
  if (t.role === "herald") {
    const h = heraldLines(s);
    text = text.replaceAll("{line}", h.line).replaceAll("{lore}", h.lore);
  }
  if (t.role === "villager" && s && VILLAGER_TOKEN.test(text)) {
    const tk = villagerTalkTokens(t, s, clan);
    for (const [k, v] of Object.entries(tk)) text = text.replaceAll(`{${k}}`, v);
    text = text.replaceAll("{trade}", tk.trade);
  }
  // Family extras: your own kin greet you as kin.
  if (text.includes("{kin}")) {
    const c = t.colonistId ? colonists.get(t.colonistId) : undefined;
    const rel = c && p ? kinRelation(p, c) : null;
    text = text.replaceAll("{kin}", kinGreeting(rel, hashOf(`${t.colonistId}:${gameDay()}`), !!p && childrenOf(p).some((k) => k.person?.child)));
  }
  // Named roles: someone you have done a service remembers it in the greeting.
  if (text.includes("{favour}")) {
    const r = namedRoleOf(t);
    text = text.replaceAll("{favour}", r && r !== "elder" && s && favourOf(s, clan, r) >= ROLE_FAVOUR_NEEDED ? "\n\n" + ROLE_REMEMBERS[r] : "");
  }
  return text.replaceAll("{npc}", t.name).replaceAll("{site}", s?.name ?? "").replaceAll("{tier}", tier ?? "");
}

// ---- named roles (shared/src/namedRoles.ts): the Elder, merchant, priest, smith and captain of a settlement ----
const NPC_NAMED: Partial<Record<NpcRole, NamedRole>> = { leader: "elder", trader: "trader", questGiver: "priest", smith: "smith", captain: "captain" };
// The named role of whoever this talk is with: only the settlement's own named person (a bakery's keeper also talks as a
// "trader", but is not its merchant).
function namedRoleOf(t: Talk): NamedRole | undefined {
  const r = NPC_NAMED[t.role];
  return r && t.siteId && t.name === namedRoleName(t.siteId, r) ? r : undefined;
}
const questRoleOf = (t: Talk): QuestRole | undefined => {
  const r = namedRoleOf(t);
  return r && r !== "elder" ? r : undefined;
};
function favourOf(s: SiteState, clan: number, r: QuestRole): number {
  return s.diplo?.[clan]?.favour?.[r] ?? 0;
}
// The captain of the watch: the garrison's knight, else a guard (the lowest id: stable while he lives).
export function captainOf(s: SiteState): Mob | undefined {
  const rank = (m: Mob) => (m.kind === "townKnight" ? 2 : m.kind === "townGuard" ? 1 : 0);
  let best: Mob | undefined;
  for (const id of s.garrison) {
    const m = mobs.get(id);
    if (!m || m.hp <= 0 || rank(m) === 0) continue;
    if (!best || rank(m) > rank(best) || (rank(m) === rank(best) && m.id < best.id)) best = m;
  }
  return best;
}
// Building types of a settlement's template (its forge, chapel, market, ...).
function siteBuildingTypes(s: SiteState): BuildingType[] {
  const tpl = s.layout ? settlementTemplateById(s.layout) : undefined;
  return (tpl?.buildings ?? []).map((b) => buildingTemplateById(b.ref)?.buildingType).filter((x): x is BuildingType => !!x);
}
// Which named people a settlement has (the Elder always; a smith needs a forge; a captain a garrison guard).
export function namedRolesAt(s: SiteState): NamedRole[] {
  const types = siteBuildingTypes(s);
  const out: NamedRole[] = ["elder"];
  if (s.workers.length > 0 || types.includes("market")) out.push("trader");
  if (s.workers.some((id) => mobs.get(id)?.siteWorker === "priest") || types.includes("church") || types.includes("abbey")) out.push("priest");
  if (types.includes("blacksmith")) out.push("smith");
  if (captainOf(s) || types.includes("barracks")) out.push("captain");
  return out;
}
// A "!" over this named person: a quest of theirs waits to be accepted, or they would ask one now (no open quest of
// theirs, past their cooldown; the captain needs a camp near, or the night).
export function namedRoleMark(clan: number, s: SiteState, role: QuestRole): boolean {
  if (!standingTown(s) || tierOf(clan, s) === "hostile") return false;
  const mine = quests.filter((q) => q.clan === clan && q.siteId === s.id && q.giver === role);
  if (mine.length) return mine.some((q) => !q.accepted);
  if ((s.diplo?.[clan]?.roleNext?.[role] ?? 0) > state.cycleTick) return false;
  return role !== "captain" || isNightNow() || !!campNear(s, clan);
}
function whosWho(s: SiteState): string {
  const lines = namedRolesAt(s).map((r) => `${namedRoleName(s.id, r)} ${NAMED_ROLE_PLACE[r]}.`);
  if (s.homes?.quest !== undefined) lines.push(`${heraldLines(s).title} ${nameFor(`${s.id}:herald`)} posts the work at the notice board.`);
  return `"Who's who in ${s.name}? Well:\n${lines.map((l) => "- " + l).join("\n")}"`;
}
// Their quests: post one now if they can, then list theirs (accept / deliver).
function roleWork(p: Player, t: Talk, s: SiteState, role: QuestRole) {
  gainSkill(p, "speech", 3);
  const r = postRoleQuest(s.id, p.clan, role);
  const def = ROLE_QUESTS[role];
  const head = typeof r !== "string" ? def.ask : r === "open" ? "" : r === "cooldown" ? def.later : def.nothing;
  return showQuests(p, t, s, fill(head, t), role);
}
// Their favour, once a game day after a service (actionBlock checks both).
function rolePerk(p: Player, t: Talk, s: SiteState, role: QuestRole) {
  const life = lifeOf(p);
  life.flags[`perk:${s.id}:${role}`] = gameDay();
  gainSkill(p, "speech", 3);
  if (role === "smith") {
    state.stock.tools = (state.stock.tools ?? 0) + SMITH_FAVOUR_TOOLS;
    return sayThen(p, t, `"Here. Still warm from the anvil. Bring me iron again some time." (+${SMITH_FAVOUR_TOOLS} tools to your stores)`);
  }
  if (role === "trader") {
    const good = TRADE_GOODS.filter((g) => Math.floor(s.stock[g] ?? 0) >= 1).sort((a, b) => (s.stock[b] ?? 0) - (s.stock[a] ?? 0))[0];
    if (!good) {
      delete life.flags[`perk:${s.id}:${role}`];
      return sayThen(p, t, `"The stalls are bare, friend. Nothing put by today."`);
    }
    const n = Math.min(TRADER_FAVOUR_GOODS, Math.floor(s.stock[good] ?? 0));
    s.stock[good] = (s.stock[good] ?? 0) - n;
    state.stock[good] = (state.stock[good] ?? 0) + n;
    gainSkill(p, "trading", 2);
    return sayThen(p, t, `"I kept these back for you. No charge, between friends." (+${n} ${good} to your stores)`);
  }
  if (role === "priest") {
    p.hp = playerMaxHp(p);
    life.rest = NEED_MAX;
    return sayThen(p, t, `${t.name} lays a hand on your brow and prays. Your wounds close and your weariness lifts. (healed and rested)`);
  }
  // Captain: his scouts' report (every standing camp within range, revealed on the minimap).
  const camps = [...hearths.values()]
    .filter((h) => !h.destroyed && sites.get(h.siteId)?.faction !== "human")
    .map((h) => ({ h, d: Math.hypot(h.x - s.keepX, h.y - s.keepY) }))
    .filter((c) => c.d <= CAPTAIN_SCOUT_RANGE_TILES)
    .sort((a, b) => a.d - b.d);
  for (const c of camps) revealAround(c.h.x, c.h.y, circleOffsets(4));
  if (!camps.length) return sayThen(p, t, `"My scouts found no camp within ${CAPTAIN_SCOUT_RANGE_TILES} tiles. Long may it last."`);
  const n = camps[0];
  return sayThen(p, t, `"My scouts count ${camps.length} camp${camps.length === 1 ? "" : "s"} within ${CAPTAIN_SCOUT_RANGE_TILES} tiles. The nearest: ${/^[aeiou]/.test(n.h.faction) ? "an" : "a"} ${n.h.faction} ${n.h.siteKind === "fort" ? "fort" : "camp"} ${Math.round(n.d)} tiles ${bearing(n.h.x - s.keepX, n.h.y - s.keepY)} of ${s.name}. I've marked them on your map."`);
}

// Villager conversation tokens (shared/src/villagerTalk.ts): this villager's trade, the weather, season and hour, who else lives
// in the settlement and which buildings it has. A villager keeps its trade for life (hash of its mob id).
const VILLAGER_TOKEN = /\{(trade|hello|work|craft|worry|past|sky|gossip|place|amenities|elderline|deed)\}/;
function villagerTalkTokens(t: Talk, s: SiteState, clan: number): Record<string, string> {
  const tpl = s.layout ? settlementTemplateById(s.layout) : undefined;
  const neighbours: string[] = [];
  // (s.workers[0] is the merchant, a named person: not gossiped about by a bare name.)
  for (const id of s.workers) {
    const m = mobs.get(id);
    if (m && id !== t.mobId && id !== s.workers[0] && m.siteWorker !== "herald" && m.siteWorker !== "priest") neighbours.push(nameFor(id));
  }
  const amenities = siteBuildingTypes(s);
  const seed = hashOf(t.mobId ?? t.name);
  return villagerTokens({
    seed, day: gameDay(), night: isNightNow(), weather: weatherNow(), season: seasonsOn() ? calendarNow().season : -1,
    tier: Math.max(1, Math.min(3, tpl?.tier ?? 2)) as 1 | 2 | 3, neighbours: neighbours.sort(), amenities, elder: `Elder ${nameFor(s.id)}`,
    deeds: s.diplo?.[clan]?.deeds,
  });
}

// Gap closure G7: the quest givers showing a "!" to this clan: a quest of theirs waits to be accepted, or the board is
// open (under QUEST_MAX_PER_SITE open quests and past the settlement's quest cooldown for the clan). Not when hostile.
export function questMarksFor(clan: number): string[] {
  const out: string[] = [];
  for (const s of sites.values()) {
    if (s.homes?.quest === undefined || !s.awake || !standingTown(s) || tierOf(clan, s) === "hostile") continue;
    const m = s.workers.map((id) => mobs.get(id)).find((w) => w?.siteWorker === "herald");
    if (!m) continue;
    const mine = boardQuestsFor(clan, s.id);
    const board = mine.length < QUEST_MAX_PER_SITE && (s.diplo?.[clan]?.questNextTick ?? 0) <= state.cycleTick;
    if (board || mine.some((q) => !q.accepted)) out.push(m.id);
  }
  // Named roles: the merchant, the priest and the captain outdoors, with work of their own for you.
  for (const s of sites.values()) {
    if (!s.awake || !standingTown(s)) continue;
    const trader = s.workers[0] !== undefined ? mobs.get(s.workers[0]) : undefined;
    if (trader && !trader.siteWorker?.match(/^(priest|herald)$/) && namedRoleMark(clan, s, "trader")) out.push(trader.id);
    const priest = s.workers.map((id) => mobs.get(id)).find((w) => w?.siteWorker === "priest");
    if (priest && namedRoleMark(clan, s, "priest")) out.push(priest.id);
    const cap = captainOf(s);
    if (cap && !cap.guardianActive && namedRoleMark(clan, s, "captain")) out.push(cap.id);
  }
  return out;
}

function siteOf(t: Talk): SiteState | undefined {
  const s = t.siteId ? sites.get(t.siteId) : undefined;
  return standingTown(s) ? s : undefined;
}

// Why an action is unavailable now ("" = it is).
function actionBlock(p: Player, t: Talk, a: DialogueAction): string {
  const s = siteOf(t);
  const life = lifeOf(p);
  const day = gameDay();
  if (a === "gift") {
    if (!s) return "";
    if (life.flags[`gift:${s.id}`] === day) return "Already gave a gift today";
    if ((state.stock.gold ?? 0) < GIFT_GOLD) return `Needs ${GIFT_GOLD} gold`;
  }
  if (a === "rumour" && s && life.flags[`rumour:${s.id}`] === day) return "Nothing new today";
  if (a === "lodging" && s && life.flags[`lodging:${s.id}`] === day) return "Already rested here today";
  if (a === "alliance" && s && life.flags[`ally:${s.id}`] === day) return "Asked today already";
  if (a === "sellPack" && packWeight(life) <= 0) return "Your pack is empty";
  if (a === "rolePerk" && s) {
    const r = questRoleOf(t);
    if (!r) return "";
    if (favourOf(s, p.clan ?? 0, r) < ROLE_FAVOUR_NEEDED) return ROLE_PERKS[r].stranger;
    if (life.flags[`perk:${s.id}:${r}`] === day) return "Not again today";
  }
  if (a === "sellAnimals" && animalsForSale(p.clan ?? 0).length === 0) return "You have no animals to sell";
  if (a === "drink") {
    if (life.flags.drinkDay === day && (life.flags.drinkN ?? 0) >= TAVERN_DRINKS_PER_DAY) return "You have had enough for today";
    if ((state.stock.gold ?? 0) < TAVERN_DRINK_GOLD) return `Needs ${TAVERN_DRINK_GOLD} gold`;
  }
  if (a === "innRumour" && (state.stock.gold ?? 0) < INN_RUMOUR_GOLD) return `Needs ${INN_RUMOUR_GOLD} gold`;
  if (a === "innRest" && (state.stock.gold ?? 0) < INN_REST_GOLD) return `Needs ${INN_REST_GOLD} gold`;
  return "";
}

// Personal stories and one-time favours use the hero's existing saved life flags.
function renderSpecialTalk(p:Player,t:Talk,node:string,prefix=''){
 const c=SPECIAL_BY_ID.get(t.specialId!);if(!c)return false;
 const story=storyDialogue(p,c.id,node);if(story){t.choices=story.choices;sendTalk(p,t,story.text);return true;}
 const life=lifeOf(p),flags=life.flags,link=SPECIAL_BY_ID.get(c.connection)!,key=`cast:${c.id}`;let done=!!flags[`${key}:done`];
 const address=specialAddress(c.id),linkAddress=specialAddress(c.connection),stockGood=c.good==='hide'?'wool':c.good;
 let text=prefix;
 const ready=()=>c.questKind==='hunt'?specialCharacterDefeated(c.connection):c.questKind==='meet'?!!flags[`cast:met:${c.connection}`]:withClan(clanOf(p),()=>{
  const pack=life.pack as Partial<Record<string,number>>;return c.good==='hide'?itemCount('hide')>=c.count:(pack[c.good]??0)+(state.stock[stockGood]??0)>=c.count;
 });
 const favour=c.questKind==='hunt'?`Defeat ${link.name}, ${link.title}, at ${linkAddress}.`:c.questKind==='meet'?`Speak with ${link.name}, ${link.title}, at ${linkAddress}.`:`Bring ${c.count} ${c.good} from your carried resources or Stockpile.`;
 if(node==='cast:accept'&&!done){flags[`${key}:accepted`]=1;text='I will remember your help. '+favour;}
 if(node==='cast:claim'){
  if(done)text='You have already helped me. I have not forgotten.';
  else if(!flags[`${key}:accepted`]||!ready())text='There is still something to do. '+favour;
  else{
   withClan(clanOf(p),()=>{
    if(c.questKind==='supply'&&c.good==='hide')takeItem('hide',c.count);
    else if(c.questKind==='supply'){const pack=life.pack as Partial<Record<string,number>>,take=Math.min(pack[c.good]??0,c.count);if(take)pack[c.good]=(pack[c.good]??0)-take;state.stock[stockGood]=Math.max(0,(state.stock[stockGood]??0)-(c.count-take));}
    state.stock.gold=(state.stock.gold??0)+c.reward;
   });
   flags[`${key}:done`]=1;done=true;gainSkill(p,'speech',12);text=`You kept your word. ${c.hook} Your help has made that possible. (+${c.reward} gold; speech experience)`;
  }
 }
 if(node==='cast:lesson'){
  if(c.child||c.hostile)text='We can still learn from one another.';
  else if(flags[`${key}:lesson`])text='You remember what I taught you. Put it to use.';
  else if(!done)text='Help me with my work first; then I can spare time to teach you.';
  else{
   const skills:Record<string,HeroSkill>={masters:'smithing',faith:'spellcasting',court:'speech',commons:'trading',rural:'farming',watch:'building',wayfarers:'hunting'};
   const skill:HeroSkill=c.id==='mara-loaf'?'baking':c.id==='jori-clay'?'pottery':c.id==='wystan-gear'?'milling':c.id==='perrin-oak'?'building':c.id==='viggo-coal'?'charcoal':skills[c.group]??'speech';
   flags[`${key}:lesson`]=1;gainSkill(p,skill,25);text=`${c.name} shows you a practical lesson in ${HERO_SKILL_LABEL[skill].toLowerCase()}. (+25 experience)`;
   if(c.group==='faith'){life.food=Math.min(NEED_MAX,life.food+15);life.rest=Math.min(NEED_MAX,life.rest+20);p.hp=Math.min(playerMaxHp(p),p.hp+20);text+=' You also receive food, rest and treatment.';}
  }
 }
 if(!text)text=node==='cast:story'?`${c.bio}\n\n${c.hook}`:node==='cast:connection'?`${link.name}, ${link.title}. ${link.bio}\n\nYou can find ${link.child?'the child':'them'} at ${linkAddress}.`:`${c.name} — ${c.title}\n${c.bio}\n\nHome: ${address}`;
 t.choices=[...storyOffers(p,c.id),{label:'Tell me your story.',next:'cast:story'},{label:`What do you know about ${link.name}?`,next:'cast:connection'}];
 if(done)t.choices.push({label:'Our favour is complete.',next:'cast:claim'});
 else if(!flags[`${key}:accepted`])t.choices.push({label:`Can I help? ${favour} (${c.reward} gold)`,next:'cast:accept'});
 else t.choices.push({label:`${favour} Claim ${c.reward} gold.`,next:'cast:claim',disabled:ready()?undefined:'The favour is not finished yet'});
 if(!c.child&&!c.hostile)t.choices.push({label:'Teach me something.',next:'cast:lesson'});
 t.choices.push({label:'Farewell.',action:'bye'});sendTalk(p,t,text);sendJournal(p);return true;
}


function renderTalk(p: Player, t: Talk, nodeId: string, prefix = "") {
  if(t.specialId&&renderSpecialTalk(p,t,nodeId,prefix))return;
  const s = siteOf(t);
  const tier = s ? tierOf(p.clan, s) : undefined;
  const node = DIALOGUE[t.role][nodeId] ?? DIALOGUE[t.role].start;
  const raw = (tier && node.text[tier]) ?? node.text.default ?? node.text.neutral ?? "";
  // Named roles: their own quests / favour / "who's who" only from the settlement's named person (not every keeper).
  const named = namedRoleOf(t);
  t.choices = node.choices
    .filter((c) => !c.tiers || (tier && c.tiers.includes(tier)))
    .filter((c) => !(c.action === "roleWork" || c.action === "rolePerk") || (named && named !== "elder"))
    .filter((c) => c.action !== "whoswho" || named === "elder")
    .map((c) => ({ label: fill(c.label, t, tier, p.clan), next: c.next, action: c.action, disabled: c.action ? actionBlock(p, t, c.action) || undefined : undefined }));
  if (nodeId === "start") {
    const extra = familyChoices(p, t);
    // Gap closure G5: whoever keeps a tavern also pours a drink.
    if (t.inside?.tavern && (t.role === "keeper" || t.role === "trader")) {
      extra.push({ label: `Buy a drink (${TAVERN_DRINK_GOLD} gold).`, action: "drink", disabled: actionBlock(p, t, "drink") || undefined });
      extra.push({ label: `Buy a rumour (${INN_RUMOUR_GOLD} gold).`, action: "innRumour", disabled: actionBlock(p, t, "innRumour") || undefined });
      extra.push({ label: `Rest at the inn (${INN_REST_GOLD} gold).`, action: "innRest", disabled: actionBlock(p, t, "innRest") || undefined });
    }
    if (extra.length) t.choices.splice(t.choices.length - 1, 0, ...extra);
  }
  sendTalk(p, t, (prefix ? prefix + "\n\n" : "") + fill(raw, t, tier, p.clan, p));
}

function sendTalk(p: Player, t: Talk, text: string) {
  const s = siteOf(t);
  const dialogue: DialogueSnapshot = {
    npc: { name: t.name, role: t.role, roleLabel: (t.specialId?SPECIAL_BY_ID.get(t.specialId)?.title:undefined)??NPC_ROLE_LABEL[t.role], ...(s ? { site: s.name, tier: tierOf(p.clan, s) } : {}), color: t.color },
    text,
    choices: t.choices.map((c) => ({ label: c.label, ...(c.disabled ? { disabled: c.disabled } : {}) })),
  };
  sendTo(p, { type: "dialogue", dialogue });
}

export function closeTalk(p: Player, extra: { openStockpile?: boolean; openTrade?: { tileX: number; tileY: number } } = {}) {
  const previous=busyOf(p).talk?.mobId;
  if(previous){const speaker=mobs.get(previous);if(speaker)releaseTownSpeaker(speaker);}
  busyOf(p).talk = undefined;
  sendTo(p, { type: "dialogue", close: true, ...extra });
}

// A node with a line of result and Back / Farewell.
function sayThen(p: Player, t: Talk, text: string, more: ChoiceRt[] = []) {
  t.choices = [...more, { label: "Back.", action: "back" }, { label: "Farewell.", action: "bye" }];
  sendTalk(p, t, text);
}

export function startTalk(p: Player, target: Target) {
  if(target.mob)holdTownSpeaker(target.mob);
  const t: Talk = {
    specialId:target.specialId, role: target.role, name: target.name, siteId: target.site?.id, mobId: target.mob?.id, colonistId: target.colonist?.id,
    color: talkColorFor(target.name), choices: [], ...(target.inside ? { inside: target.inside } : {}),
  };
  busyOf(p).talk = t;
  const life = lifeOf(p);
  const storyLine=target.specialId?storyOnMeet(p,target.specialId):'';
  if (target.site) life.flags[`met:${target.site.id}`] = gameDay();
  renderTalk(p, t, "start",storyLine);
}

// Stardew phase 5c: a bed / chest inside an interior, spoken to like an NPC (choices built by interiors.ts).
export function furnitureTalk(p: Player, name: string, text: string, choices: ChoiceRt[], inside: TalkInside) {
  const b = busyOf(p);
  const t: Talk = b.talk?.role === "furniture" && b.talk.name === name ? b.talk : { role: "furniture", name, color: 0x8a5a2b, choices: [], inside };
  t.inside=inside;
  t.choices = [...choices, { label: "Close.", action: "bye" }];
  b.talk = t;
  sendTalk(p, t, text);
}

// Still in talking range of the NPC (it may walk off or die).
function talkInRange(p: Player, t: Talk): boolean {
  // Stardew phase 5c: inside an interior the distance is measured there (the NPC's world body may be anywhere).
  if(t.inside?.world)return !p.interior&&Math.hypot(t.inside.x-p.x,t.inside.y-p.y)/TILE_SIZE<=TALK_RANGE_TILES+2;
  if (t.inside || p.interior) {
    const s = t.siteId ? sites.get(t.siteId) : undefined;
    return !!t.inside && p.interior?.key === t.inside.key && Math.hypot(t.inside.x - p.interior.x, t.inside.y - p.interior.y) / TILE_SIZE <= TALK_RANGE_TILES + 2
      && (!t.colonistId || (colonists.get(t.colonistId)?.hp ?? 0) > 0) && (!t.siteId || standingTown(s));
  }
  if (t.colonistId) {
    const c = colonists.get(t.colonistId);
    return !!c && Math.hypot(c.x - p.x, c.y - p.y) / TILE_SIZE <= TALK_RANGE_TILES + 2;
  }
  if (t.mobId) {
    const m = mobs.get(t.mobId);
    return !!m && Math.hypot(m.x - p.x, m.y - p.y) / TILE_SIZE <= TALK_RANGE_TILES + 2;
  }
  const s = siteOf(t);
  return !!s && tileCenterDist(p, s.keepX, s.keepY) <= TALK_RANGE_TILES + 2;
}

export function handleDialogueChoice(p: Player, idx: unknown) {
  const t = busyOf(p).talk;
  if (!t || typeof idx !== "number" || !Number.isInteger(idx)) return;
  const c = t.choices[idx];
  if (!c) return;
  if (!talkInRange(p, t) || p.dead) {
    closeTalk(p);
    toast(p, "You are too far away to talk");
    return;
  }
  if (c.disabled) {
    toast(p, c.disabled);
    return;
  }
  if (c.next) return renderTalk(p, t, c.next);
  const s = siteOf(t);
  const life = lifeOf(p);
  const day = gameDay();
  switch (c.action) {
    case "bye":
      return closeTalk(p);
    case "back":
      if(t.inside?.key==='town-board'){const s=siteOf(t);if(s)return showQuests(p,t,s,'Town notices');return;}
      return renderTalk(p, t, "start");
    case "pick": {
      const x = t.picks?.[Number(c.arg)];
      return x ? startTalk(p, x) : closeTalk(p);
    }
    case "trade":
      if (!s) return closeTalk(p);
      gainSkill(p, "trading", 2);
      return closeTalk(p, { openTrade: { tileX: s.keepX, tileY: s.keepY } });
    case "sellPack":
      return s ? sayThen(p, t, sellPack(p, s)) : closeTalk(p);
    // Gap closure G6: the clan's animals (dearest first) at the panel's sell price; gold into the stores.
    case "sellAnimals":
    case "sellAnimal": {
      if (!s) return closeTalk(p);
      const said = c.action === "sellAnimal" ? sellAnimalTo(p.clan ?? 0, Number(c.arg), `the trader of ${s.name}`) : "";
      if (said && !said.startsWith("That")) gainSkill(p, "trading", 3);
      const list = animalsForSale(p.clan ?? 0);
      const more: ChoiceRt[] = list.map((x) => ({ label: `Sell ${x.label} (${x.price} gold).`, action: "sellAnimal", arg: x.id }));
      return sayThen(p, t, (said ? said + ".\n\n" : "") + (list.length ? `"Bring them to me; I'll see them home. What are you selling?"` : `"Nothing left to sell, then."`), more);
    }
    case "gift": {
      if (!s) return closeTalk(p);
      state.stock.gold -= GIFT_GOLD;
      s.stock.gold = (s.stock.gold ?? 0) + GIFT_GOLD;
      life.flags[`gift:${s.id}`] = day;
      const g = GIFT_RELATION * (1 + 0.25 * (skillLevel(life, "speech") - 1));
      adjustRelation(p.clan, s.id, g);
      gainSkill(p, "speech", 10);
      return sayThen(p, t, `"Most generous." (relation +${g.toFixed(1)}, now ${Math.round(relationOf(p.clan, s.id))})`);
    }
    case "directions": {
      if(!s)return closeTalk(p);
      const labels=new Map<number,string>([[TileType.Market,'market'],[TileType.Bakery,'bakery'],[TileType.Blacksmith,'blacksmith'],[TileType.Bloomery,'bloomery'],[TileType.TailorShop,'tailor'],[TileType.BuildersGuild,'carpentry yard'],[TileType.Stables,'stables']]);
      const found=new Map<string,{x:number;y:number}>();
      for(let y=s.y0;y<=s.y1;y++)for(let x=s.x0;x<=s.x1;x++){const label=labels.get(state.tiles[tileIndex(x,y)]);if(label&&!found.has(label))found.set(label,{x,y});}
      const directions=[...found].map(([label,at])=>`${label}: ${Math.round(Math.hypot(at.x-p.x/TILE_SIZE,at.y-p.y/TILE_SIZE))} paces ${bearing(at.x-p.x/TILE_SIZE,at.y-p.y/TILE_SIZE)}`);
      for(const[,at]of found)revealAround(at.x,at.y,circleOffsets(2));
      const key=`directions:${s.id}:${gameDay()}`;
      if(!life.flags[key]){gainSkill(p,'speech',1);life.flags[key]=1;}
      return sayThen(p,t,directions.length?`"Of course. Here is your way around ${s.name}."\n`+directions.join('\n'):'"Ask the trader at the square; we have few shops here."');
    }
    case "rumour":
      if (s) life.flags[`rumour:${s.id}`] = day;
      gainSkill(p, "speech", 3);
      return sayThen(p, t, rumourAbout(p));
    // Gap closure G5: a tavern patron's rumour; a drink (gold: rest, a little cheer for the colony).
    case "patronRumour":
      if (life.flags[`prumour:${t.name}`] !== day) gainSkill(p, "speech", 2);
      life.flags[`prumour:${t.name}`] = day;
      return sayThen(p, t, patronRumour(p, t.name));
    case "drink": {
      if (life.flags.drinkDay !== day) life.flags.drinkN = 0;
      life.flags.drinkDay = day;
      life.flags.drinkN = (life.flags.drinkN ?? 0) + 1;
      state.stock.gold -= TAVERN_DRINK_GOLD;
      if (s) s.stock.gold = (s.stock.gold ?? 0) + TAVERN_DRINK_GOLD;
      life.rest = Math.min(NEED_MAX, life.rest + TAVERN_DRINK_REST);
      tavernCheer.set(p.clan ?? 0, state.cycleTick + TAVERN_DRINK_CHEER_TICKS);
      return sayThen(p, t, `A mug of ale, warm bread on the side. You feel better (rest +${TAVERN_DRINK_REST}; your people's spirits lift a little).`);
    }
    case "innRumour": {
      state.stock.gold -= INN_RUMOUR_GOLD;
      if (s) s.stock.gold = (s.stock.gold ?? 0) + INN_RUMOUR_GOLD;
      return sayThen(p, t, innRumour(p));
    }
    case "innRest":
      state.stock.gold -= INN_REST_GOLD;
      if (s) s.stock.gold = (s.stock.gold ?? 0) + INN_REST_GOLD;
      life.rest = NEED_MAX;
      life.energy = ENERGY_MAX;
      life.food = Math.min(NEED_MAX, life.food + INN_REST_FOOD);
      return sayThen(p, t, `"A bed upstairs, and stew before you go." You wake rested.`);
    case "lodging":
      if (s) life.flags[`lodging:${s.id}`] = day;
      life.rest = NEED_MAX;
      life.energy = ENERGY_MAX;
      life.food = Math.min(NEED_MAX, life.food + 20);
      return sayThen(p, t, `"Take the bed by the hearth, and some stew." You feel rested.`);
    case "alliance": {
      if (!s) return closeTalk(p);
      life.flags[`ally:${s.id}`] = day;
      const need = ALLIANCE_ASK_MIN - 5 * (skillLevel(life, "speech") - 1);
      const rel = relationOf(p.clan, s.id);
      gainSkill(p, "speech", 20);
      if (rel < need) return sayThen(p, t, `"Not yet. Prove yourself to ${s.name} first." (relation ${Math.round(rel)}, needs ${need})`);
      adjustRelation(p.clan, s.id, Math.max(0, RELATION_ALLIED_MIN - rel));
      return sayThen(p, t, `"Then let it be so: ${s.name} stands with you." (now Allied)`);
    }
    case "askWork":
      return s ? askForWork(p, t, s) : closeTalk(p);
    case "roleWork": {
      const r = questRoleOf(t);
      return s && r ? roleWork(p, t, s, r) : closeTalk(p);
    }
    case "rolePerk": {
      const r = questRoleOf(t);
      return s && r ? rolePerk(p, t, s, r) : closeTalk(p);
    }
    case "whoswho":
      return s ? sayThen(p, t, whosWho(s)) : closeTalk(p);
    case "quests":
      return s ? showQuests(p, t, s, "") : closeTalk(p);
    case "accept":
    case "deliver": {
      if (!s) return closeTalk(p);
      if (c.action === "deliver") packToStock(life, c.arg as string);
      const why = handleQuestMessage(p, c.action === "accept" ? "acceptQuest" : "deliverQuest", c.arg === undefined ? undefined : Number(String(c.arg).split(":")[0]));
      if (!why) gainSkill(p, "speech", 5);
      return showQuests(p, t, s, why || (c.action === "accept" ? "\"Thank you. Come back when it is done.\"" : "\"Just what we needed.\""), t.listGiver);
    }
    case "train":
      return s ? showMasters(p, t, s, "") : closeTalk(p);
    case "learn":
      return s ? learnSkill(p, t, s, c.arg as HeroSkill) : closeTalk(p);
    case "fare":
      return sayThen(p, t, fareOf(t));
    case "kin":
      return s ? showKin(p, t, s, "") : closeTalk(p);
    case "court":
    case "courtGift":
    case "propose":
      return courtAction(p, t, c.action, String(c.arg ?? ""));
    case "marry":
      return wedding(p, t);
    case "part":
      return sayThen(p, t, partWays(p));
    // Stardew phase 5c (interiors): the building's own panel (shop, forge, ...), the bed and the chest.
    case "interiorObject":
      return handleInteriorObjectChoice(p,String(c.arg??""));
    case "craftRecipe":
      return handlePersonalCraft(p, String(c.arg ?? ""), t.inside ? { tx: t.inside.anchor.x, ty: t.inside.anchor.y } : undefined);
    case "openStockpile":
      if(sharedStockAccess(p)) return closeTalk(p,{openStockpile:true});
      return closeTalk(p);
    case "openBuilding":
      return t.inside ? closeTalk(p, { openTrade: { tileX: t.inside.anchor.x, tileY: t.inside.anchor.y } }) : closeTalk(p);
    case "worldChestPut":
    case "worldChestTake":
      return t.inside?.world?worldChestChoice(p,t.inside,c.action,c.arg):closeTalk(p);
    case "sleep":
    case "nap":
    case "chestPut":
    case "chestTake":
      return interiorFurnitureChoice(p, c.action, c.arg);
    case "kinLevy": {
      if (!s) return closeTalk(p);
      const why = handleCallToArms(p, s, {});
      return sayThen(p, t, why ? `"${why}."` : `"For family, we march." The ${s.name} levy follows you.`);
    }
  }
}

// ---- family: courtship, proposal, ceremony (family.ts holds the state changes) ----
const kinNameOf = (s: SiteState) => nameFor(`${s.id}:kin`);

function courtChoices(p: Player, key: string, name: string, s?: SiteState): ChoiceRt[] {
  const life = lifeOf(p);
  const day = gameDay();
  const gold = state.stock.gold ?? 0;
  const pts = life.flags[`court:${key}`] ?? 0;
  return [
    { label: `Spend time with ${name}.`, action: "court", arg: key, disabled: life.flags[`courtDay:${key}`] === day ? "You spent time together today" : undefined },
    { label: `A gift for ${name} (${COURT_GIFT_GOLD} gold).`, action: "courtGift", arg: key,
      disabled: life.flags[`courtGiftDay:${key}`] === day ? "Already gave a gift today" : gold < COURT_GIFT_GOLD ? `Needs ${COURT_GIFT_GOLD} gold` : undefined },
    { label: `Will you marry me?${s ? ` (${BRIDE_GIFT_GOLD} gold bride gift)` : ""}`, action: "propose", arg: key,
      disabled: pts < COURT_NEEDED ? `Courtship ${pts} / ${COURT_NEEDED}` : s && gold < BRIDE_GIFT_GOLD ? `Needs ${BRIDE_GIFT_GOLD} gold` : undefined },
  ];
}

// Extra start choices: courting one of your own people, "Marry us" from a priest when betrothed.
function familyChoices(p: Player, t: Talk): ChoiceRt[] {
  const out: ChoiceRt[] = [];
  const f = familyOf(p);
  const c = t.colonistId ? colonists.get(t.colonistId) : undefined;
  if (f.betrothed && (t.role === "questGiver" || t.role === "priest" || c?.kind === "bishop")) {
    out.push({ label: `Marry us: ${f.betrothed.name} and I (${CEREMONY_FEE} gold).`, action: "marry", disabled: (state.stock.gold ?? 0) < CEREMONY_FEE ? `Needs ${CEREMONY_FEE} gold` : undefined });
  }
  if (t.role === "folk" && c && !heroTaken(p) && courtable(p, c)) out.push(...courtChoices(p, `c:${c.id}`, c.person!.name));
  if (t.role === "folk" && c && kinRelation(p, c) === "spouse") out.push({ label: "We should part ways.", action: "part" });
  return out;
}

function showKin(p: Player, t: Talk, s: SiteState, head: string) {
  const life = lifeOf(p);
  const f = familyOf(p);
  const name = kinNameOf(s);
  const pre = head ? head + "\n\n" : "";
  if ((life.flags[`feud:${s.id}`] ?? 0) > gameDay()) return sayThen(p, t, `${pre}"After what you did? No one of my house will have you."`);
  if (kinBond(s, p.clan)) return sayThen(p, t, `${pre}"We are family now. Our spears are yours when you need them."`, [{ label: "Kin, we need your spears.", action: "kinLevy" }]);
  if (f.betrothed?.key === `s:${s.id}`) return sayThen(p, t, `${pre}"${name} waits for the wedding. Find a priest to bless it."`);
  if (heroTaken(p)) return sayThen(p, t, `${pre}"You are spoken for already."`);
  return sayThen(p, t, `${pre}"My kin ${name} is unwed. Win their heart, and a bride gift, and our houses are joined."`, courtChoices(p, `s:${s.id}`, name, s));
}

function courtAction(p: Player, t: Talk, a: "court" | "courtGift" | "propose", key: string) {
  const life = lifeOf(p);
  const f = familyOf(p);
  const day = gameDay();
  const s = key.startsWith("s:") ? sites.get(key.slice(2)) : undefined;
  const c = key.startsWith("c:") ? colonists.get(key.slice(2)) : undefined;
  const name = s ? kinNameOf(s) : c?.person?.name ?? "";
  const back = (msg: string) => (s ? showKin(p, t, s, msg) : renderTalk(p, t, "start", msg));
  if ((s && !standingTown(s)) || (!s && !(c && courtable(p, c))) || heroTaken(p)) return sayThen(p, t, "That cannot be now.");
  const pk = `court:${key}`;
  if (a === "court") {
    life.flags[`courtDay:${key}`] = day;
    life.flags[pk] = (life.flags[pk] ?? 0) + 1;
    gainSkill(p, "speech", 5);
    return back(`You walk and talk with ${name} a while. (courtship ${life.flags[pk]} / ${COURT_NEEDED})`);
  }
  if (a === "courtGift") {
    state.stock.gold -= COURT_GIFT_GOLD;
    if (s) s.stock.gold = (s.stock.gold ?? 0) + COURT_GIFT_GOLD;
    life.flags[`courtGiftDay:${key}`] = day;
    life.flags[pk] = (life.flags[pk] ?? 0) + 2;
    gainSkill(p, "speech", 5);
    return back(`${name} smiles at the gift. (courtship ${life.flags[pk]} / ${COURT_NEEDED})`);
  }
  if (s) {
    state.stock.gold -= BRIDE_GIFT_GOLD;
    s.stock.gold = (s.stock.gold ?? 0) + BRIDE_GIFT_GOLD;
  }
  f.betrothed = { key, name };
  gainSkill(p, "speech", 20);
  return back(`"Yes!" You are betrothed to ${name}${s ? ` (bride gift ${BRIDE_GIFT_GOLD} gold paid to ${s.name})` : ""}. Find a priest to wed you.`);
}

// The ceremony at a priest (a settlement's or your own Church's bishop).
function wedding(p: Player, t: Talk) {
  const f = familyOf(p);
  const b = f.betrothed;
  if (!b) return renderTalk(p, t, "start");
  const s = b.key.startsWith("s:") ? sites.get(b.key.slice(2)) : undefined;
  let c = b.key.startsWith("c:") ? colonists.get(b.key.slice(2)) : undefined;
  if (b.key.startsWith("s:") ? !standingTown(s) : !(c && courtable(p, c))) {
    delete f.betrothed;
    return sayThen(p, t, `"I am sorry. That match can no longer be."`);
  }
  if ((state.stock.gold ?? 0) < CEREMONY_FEE) return sayThen(p, t, `"The ceremony is ${CEREMONY_FEE} gold."`);
  if (s) {
    c = bringKinHome(p, b.name) ?? undefined;
    if (!c) return sayThen(p, t, `"Where would you take ${b.name}? You have no home (Town Center) of your own."`);
  }
  state.stock.gold -= CEREMONY_FEE;
  const at = siteOf(t);
  if (at) at.stock.gold = (at.stock.gold ?? 0) + CEREMONY_FEE;
  marry(p, c!, s);
  gainSkill(p, "speech", 10);
  return sayThen(p, t, `"Before all here, I bless this union." You and ${b.name} are wed${s ? `; ${s.name} is now bound to you by marriage` : ""}.`);
}

function fareOf(t: Talk): string {
  const c = t.colonistId ? colonists.get(t.colonistId) : undefined;
  if (!c) return "They have gone.";
  if (!c.person) return `"The work keeps me busy. The stores hold ${Math.floor(state.stock.grain + state.stock.meat + state.stock.fruit)} food."`;
  const prof = professionOf(c);
  const work = prof ? `a level-${workerLevel(c)} ${PROFESSION_LABEL[prof]}` : `a ${c.kind}`;
  const home = c.person.homeX >= 0 ? "a roof over my head" : "no bed of my own yet";
  return `"I am ${work}, with ${home}. The stores hold ${Math.floor(state.stock.grain + state.stock.meat + state.stock.fruit)} food."`;
}

// Direction words for a tile offset.
function bearing(dx: number, dy: number): string {
  const a = (Math.atan2(dy, dx) * 180) / Math.PI;
  const dirs = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];
  return dirs[(Math.round(a / 45) + 8) % 8];
}

// The nearest standing camp and the nearest other settlement; both are revealed on the minimap.
function rumourAbout(p: Player): string {
  const px = p.x / TILE_SIZE;
  const py = p.y / TILE_SIZE;
  const lines: string[] = [];
  let camp: { x: number; y: number; d: number; faction: string } | null = null;
  for (const h of hearths.values()) {
    if (h.destroyed) continue;
    const d = Math.hypot(h.x - px, h.y - py);
    if (!camp || d < camp.d) camp = { x: h.x, y: h.y, d, faction: h.faction };
  }
  if (camp) {
    lines.push(`"They say a ${camp.faction} camp lies about ${Math.round(camp.d)} tiles ${bearing(camp.x - px, camp.y - py)} of here."`);
    revealAround(camp.x, camp.y, circleOffsets(4));
  }
  let town: { s: SiteState; d: number } | null = null;
  for (const s of sites.values()) {
    if (!standingTown(s)) continue;
    const d = Math.hypot(s.keepX - px, s.keepY - py);
    if (d > 12 && (!town || d < town.d)) town = { s, d };
  }
  if (town) {
    lines.push(`"Folk at ${town.s.name}, ${Math.round(town.d)} tiles ${bearing(town.s.keepX - px, town.s.keepY - py)}, pay well for help."`);
    revealAround(town.s.keepX, town.s.keepY, circleOffsets(4));
  }
  return lines.length ? lines.join(" ") : "\"Quiet roads lately. Can't complain.\"";
}

// Gap closure G5: a tavern patron's rumour, one of up to four kinds (picked by who tells it and the day): the nearest
// standing camp, the nearest settlement, the nearest iron ore, how many camps lie within a day's walk. The place
// named is revealed on the minimap.
function patronRumour(p: Player, who: string): string {
  const px = p.x / TILE_SIZE;
  const py = p.y / TILE_SIZE;
  const lines: (() => string)[] = [];
  let camp: { x: number; y: number; d: number; faction: string } | null = null;
  let campsNear = 0;
  for (const h of hearths.values()) {
    if (h.destroyed) continue;
    const d = Math.hypot(h.x - px, h.y - py);
    if (d <= 40) campsNear++;
    if (!camp || d < camp.d) camp = { x: h.x, y: h.y, d, faction: h.faction };
  }
  if (camp) {
    const c = camp;
    lines.push(() => {
      revealAround(c.x, c.y, circleOffsets(4));
      return `"A ${c.faction} camp sits about ${Math.round(c.d)} tiles ${bearing(c.x - px, c.y - py)} of here. Lost a cousin on that road."`;
    });
  }
  if (campsNear > 0) lines.push(() => `"I count ${campsNear} camp${campsNear === 1 ? "" : "s"} within a day's walk. Bar your doors at night."`);
  let town: { s: SiteState; d: number } | null = null;
  for (const s of sites.values()) {
    if (!standingTown(s)) continue;
    const d = Math.hypot(s.keepX - px, s.keepY - py);
    if (d > 12 && (!town || d < town.d)) town = { s, d };
  }
  if (town) {
    const tw = town;
    lines.push(() => {
      revealAround(tw.s.keepX, tw.s.keepY, circleOffsets(4));
      return `"Came here by way of ${tw.s.name}, ${Math.round(tw.d)} tiles ${bearing(tw.s.keepX - px, tw.s.keepY - py)}. Fair traders, if you can stand the smell."`;
    });
  }
  let ore: { x: number; y: number; d: number } | null = null;
  for (const i of tileIndicesOf(TileType.IronOre)) {
    const x = i % state.WORLD_TILES_X;
    const y = Math.floor(i / state.WORLD_TILES_X);
    const d = Math.hypot(x - px, y - py);
    if (!ore || d < ore.d) ore = { x, y, d };
  }
  if (ore) {
    const o = ore;
    lines.push(() => {
      revealAround(o.x, o.y, circleOffsets(3));
      return `"Miners say there's iron in the rocks ${Math.round(o.d)} tiles ${bearing(o.x - px, o.y - py)}. Rich seam, too."`;
    });
  }
  if (!lines.length) return `"Quiet roads lately. I'd drink to that."`;
  return lines[hashOf(`${who}:${gameDay()}`) % lines.length]();
}

// Innkeeper's paid rumour: every known place (camps, other towns, iron ore) nearest first; each purchase reveals the next
// one (a counter in the hero's flags), so buying again never repeats a place.
function innRumour(p: Player): string {
  const px = p.x / TILE_SIZE;
  const py = p.y / TILE_SIZE;
  const spots: { x: number; y: number; r: number; d: number; text: string }[] = [];
  for (const h of hearths.values()) {
    if (!h.destroyed) spots.push({ x: h.x, y: h.y, r: 4, d: Math.hypot(h.x - px, h.y - py), text: `A ${h.faction} camp` });
  }
  for (const s of sites.values()) {
    if (!standingTown(s)) continue;
    const d = Math.hypot(s.keepX - px, s.keepY - py);
    if (d > 12) spots.push({ x: s.keepX, y: s.keepY, r: 4, d, text: `The settlement of ${s.name}` });
  }
  for (const i of tileIndicesOf(TileType.IronOre)) {
    const x = i % state.WORLD_TILES_X;
    const y = Math.floor(i / state.WORLD_TILES_X);
    spots.push({ x, y, r: 3, d: Math.hypot(x - px, y - py), text: "A rich iron seam" });
  }
  if (!spots.length) return `"Quiet roads lately. Keep your coin, friend."`;
  spots.sort((a, b) => a.d - b.d);
  const life = lifeOf(p);
  const n = life.flags.innRumourN ?? 0;
  life.flags.innRumourN = n + 1;
  const w = spots[n % spots.length];
  revealAround(Math.round(w.x), Math.round(w.y), circleOffsets(w.r));
  return `"${w.text} lies ${Math.round(w.d)} tiles ${bearing(w.x - px, w.y - py)} of here. I'd mark it on your map." (revealed on the minimap)`;
}

// Gap closure G5: a drink lifts the clan's happiness by TAVERN_DRINK_HAPPINESS for a while (colonists.ts).
const tavernCheer = new Map<number, number>();
export function tavernCheerHappiness(clan: number): number {
  return state.cycleTick < (tavernCheer.get(clan) ?? -1) ? TAVERN_DRINK_HAPPINESS : 0;
}

// The settlement posts this clan a quest now if it can (its cooldown and the per-settlement cap apply).
function askForWork(p: Player, t: Talk, s: SiteState) {
  gainSkill(p, "speech", 3);
  const open = boardQuestsFor(p.clan, s.id).length;
  if (open >= QUEST_MAX_PER_SITE) return showQuests(p, t, s, "\"You have our work already.\"");
  if ((s.diplo?.[p.clan]?.questNextTick ?? 0) > state.cycleTick) return showQuests(p, t, s, "\"Nothing new yet. Come back in a day or so.\"");
  const kinds = isNightNow() ? (["defend", "clearCamp", "deliver"] as const) : (["clearCamp", "deliver"] as const);
  for (const k of kinds) if (typeof forcePostQuest(s.id, p.clan, k) !== "string") return showQuests(p, t, s, "\"As it happens, there is something.\"");
  return showQuests(p, t, s, "\"We need nothing right now. Thank you for asking.\"");
}

// giver: only that named person's quests (their own list); else all the settlement's quests for the clan.
function showQuests(p: Player, t: Talk, s: SiteState, head: string, giver?: QuestRole) {
  t.listGiver = giver;
  const mine = questsForSnapshot(p.clan).filter((q) => q.siteNum === s.num && (!giver || q.giverRole === giver));
  const choices: ChoiceRt[] = [];
  for (const q of mine.slice(0, 3)) {
    if (!q.accepted) choices.push({ label: `I'll do it: ${q.title} (${q.reward} gold)`, action: "accept", arg: q.id });
    else if (q.kind === "deliver" && q.good) choices.push({ label: `Deliver ${q.qty} ${q.good}`, action: "deliver", arg: `${q.id}:${q.good}` });
  }
  const list = mine.length ? mine.map((q) => `- ${q.title}${q.accepted ? " (accepted)" : ""}: ${q.reward} gold`).join("\n") : "\"Nothing for you right now.\"";
  sayThen(p, t, (head ? head + "\n\n" : "") + list, choices);
}

// The 3 skills this settlement's masters teach (stable per settlement).
function mastersAt(s: SiteState): HeroSkill[] {
  const pool = HERO_SKILLS.filter((k) => k !== "speech" && k !== "spellcasting");
  const out: HeroSkill[] = [];
  for (let i = 0; out.length < 3; i++) {
    const k = pool[hashOf(s.id + i) % pool.length];
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

function showMasters(p: Player, t: Talk, s: SiteState, head: string) {
  const life = lifeOf(p);
  const choices: ChoiceRt[] = mastersAt(s).map((k) => {
    const lv = skillLevel(life, k);
    const fee = MASTER_FEE * Math.max(0, MASTER_MAX_LEVEL - lv);
    const disabled = lv >= MASTER_MAX_LEVEL ? "You know all they can teach" : (state.stock.gold ?? 0) < fee ? `Needs ${fee} gold` : undefined;
    return { label: `Learn ${HERO_SKILL_LABEL[k]} to level ${MASTER_MAX_LEVEL} (${fee} gold)`, action: "learn", arg: k, disabled };
  });
  sayThen(p, t, (head ? head + "\n\n" : "") + `"Our masters teach the first steps of a trade, for coin."`, choices);
}

function learnSkill(p: Player, t: Talk, s: SiteState, k: HeroSkill) {
  const life = lifeOf(p);
  if (!mastersAt(s).includes(k)) return showMasters(p, t, s, "");
  const lv = skillLevel(life, k);
  const fee = MASTER_FEE * Math.max(0, MASTER_MAX_LEVEL - lv);
  if (lv >= MASTER_MAX_LEVEL || (state.stock.gold ?? 0) < fee) return showMasters(p, t, s, "");
  state.stock.gold -= fee;
  s.stock.gold = (s.stock.gold ?? 0) + fee;
  life.skills[k] = Math.max(life.skills[k] ?? 0, skillXpFor(MASTER_MAX_LEVEL));
  showMasters(p, t, s, `You train for a while. ${HERO_SKILL_LABEL[k]} is now level ${MASTER_MAX_LEVEL}.`);
}

// Pack goods into the clan stock (fish keeps as meat). Only `good` when given ("<id>:<good>" from a quest choice).
function packToStock(life: HeroLife, arg?: string): number {
  const only = arg?.includes(":") ? arg.split(":")[1] : undefined;
  let n = 0;
  for (const g of PACK_GOODS) {
    const q = life.pack[g] ?? 0;
    const key = g === "fish" ? "meat" : g;
    if (q <= 0 || (only && key !== only)) continue;
    state.stock[key] = (state.stock[key] ?? 0) + q;
    delete life.pack[g];
    n += q;
  }
  return n;
}

// Sell the pack's trade goods to the settlement (relation tier prices, its purse and daily caps); what they don't take
// stays in the pack.
function sellPack(p: Player, s: SiteState): string {
  const life = lifeOf(p);
  const sold: string[] = [];
  let gold = 0;
  for (const g of PACK_GOODS) {
    const q = life.pack[g] ?? 0;
    const key = (g === "fish" ? "meat" : g) as TradeGood;
    if (q <= 0 || !TRADE_GOODS.includes(key)) continue;
    const before = state.stock[key] ?? 0;
    const goldBefore = state.stock.gold ?? 0;
    state.stock[key] = before + q;
    const r = handleTradeWithSite(p, s, key, Math.min(q, 50), "sell");
    const left = Math.max(0, Math.min(q, (state.stock[key] ?? 0) - before));
    state.stock[key] = before;
    if (left > 0) life.pack[g] = left;
    else delete life.pack[g];
    if (r.ok) {
      sold.push(`${q - left} ${PACK_LABEL[g].toLowerCase()}`);
      gold += (state.stock.gold ?? 0) - goldBefore;
    }
  }
  if (sold.length === 0) return `"I'll not buy that today."`;
  gainSkill(p, "trading", Math.max(1, Math.round(gold / 2)));
  return `Sold ${sold.join(", ")} for ${gold} gold.`;
}

// ---- interact (E) ----
// Stardew phase 5a: `m` carries the hotbar tool in hand and the faced tile. Talking comes first; then the tool on the
// faced tile (or a ripe crop there by hand); then the old gather / station rules; the tool's refusal is shown last.
export function handleInteract(p: Player, m: Record<string, unknown> = {}) {
  if (p.dead) return;
  // Stardew phase 5c: inside an interior E talks / uses the bed or chest / leaves.
  if (p.interior) return interiorInteract(p);
  if(!isMounted(p)&&tryWorldChest(p,m.tx,m.ty))return;
  if(!Number.isInteger(m.tx)&&!Number.isInteger(m.ty)){
   const px=Math.floor(p.x/TILE_SIZE),py=Math.floor(p.y/TILE_SIZE);
   for(let y=py-2;y<=py+2;y++)for(let x=px-2;x<=px+2;x++)if(inBounds(x,y)&&state.tiles[tileIndex(x,y)]===TileType.TownQuestBoard&&tileCenterDist(p,x,y)<=TALK_RANGE_TILES)return handleInteract(p,{tx:x,ty:y});
  }
  const b = busyOf(p);
  if(Number.isInteger(m.tx)&&Number.isInteger(m.ty)&&inBounds(m.tx as number,m.ty as number)){
   const x=m.tx as number,y=m.ty as number,i=tileIndex(x,y);
   if(state.tiles[i]===TileType.TownQuestBoard){
    if(tileCenterDist(p,x,y)>TALK_RANGE_TILES)return toast(p,'Move closer to read the noticeboard');
    const s=[...sites.values()].find(s=>s.num===ownerAt(i)&&standingTown(s));if(!s)return;
    const t:Talk={role:'leader',name:s.name+' noticeboard',siteId:s.id,color:0x98744d,choices:[],inside:{world:true,x:(x+.5)*TILE_SIZE,y:(y+.5)*TILE_SIZE,key:'town-board',anchor:{x,y}}};
    b.talk=t;return showQuests(p,t,s,'Town notices');
   }
  }
  const near = talkTargets(p);
  if(typeof m.npcId==='string'){
    const target=near.find(t=>t.mob?.id===m.npcId||t.colonist?.id===m.npcId);
    if(!target)return toast(p,'Walk closer to talk to them');
    if(target.mob)holdTownSpeaker(target.mob);
    return startTalk(p,target);
  }
  if (near.length) {
    b.gather = undefined;
    b.tool = undefined;
    b.resting = false;
    const tied = near.filter((x) => x.d - near[0].d <= TALK_TIE_TILES);
    return tied.length > 1 ? startTalkChooser(p, tied) : startTalk(p, near[0]);
  }
  // Gap closure G6: a rider only talks; doors, tools, animals and work need the hero on foot.
  if (isMounted(p)) return toast(p, "Dismount first (X): no doors, tools or work from the saddle");
  // Stardew phase 5c: nobody to talk to: at a prefab building's door E enters it (walking into it always does).
  if (tryEnterAtDoor(p, false)) return;
  // Stardew phase 5d: tame a wild animal, or tend an own animal house (feeder, trough, collect).
  if (heroAnimalInteract(p, m.tool)) return;
  let toolWhy = "";
  if (Number.isInteger(m.tx) && Number.isInteger(m.ty)) {
    toolWhy = useTool(p, (HERO_TOOLS as unknown[]).includes(m.tool) ? (m.tool as HeroTool) : null, m.tx as number, m.ty as number, m.crop, false);
    if (toolWhy === "") return;
  }
  const src = findGatherSource(p);
  if (src) return startGather(p, src.tx, src.ty, src.kind);
  const st = findOwnStation(p);
  if (st) {
    if (b.work && b.work.tx === st.tx && b.work.ty === st.ty) {
      b.work = undefined;
      return toast(p, "You stop working");
    }
    return handlePersonalCraft(p);
  }
  if (toolWhy && toolWhy !== "-") return toast(p, toolWhy);
  sendTo(p, { type: "interactNone" });
}

// Space / left click with a hotbar tool: the tool on the faced tile only (no talk, no fallback).
export function handleHeroTool(p: Player, m: Record<string, unknown>) {
  if (p.interior) return toast(p, "Your tools have no use indoors");
  if (isMounted(p)) return toast(p, "Dismount first (X) to use your tools");
  if (p.dead || !(HERO_TOOLS as unknown[]).includes(m.tool) || !Number.isInteger(m.tx) || !Number.isInteger(m.ty)) return;
  const why = useTool(p, m.tool as HeroTool, m.tx as number, m.ty as number, m.crop, true);
  if (why && why !== "-") toast(p, why);
}

// The tool (null = bare hands: harvest a ripe crop) on tile (tx, ty), which must touch the hero's tile. "" = started;
// "-" = nothing for this tool there (no message); else why not.
function useTool(p: Player, tool: HeroTool | null, tx: number, ty: number, cropArg: unknown, once: boolean): string {
  const mx = Math.floor(p.x / TILE_SIZE);
  const my = Math.floor(p.y / TILE_SIZE);
  if (!inBounds(tx, ty) || Math.max(Math.abs(tx - mx), Math.abs(ty - my)) > 1) return "-";
  const b = busyOf(p);
  const life = lifeOf(p);
  const clan = p.clan ?? 0;
  const i = tileIndex(tx, ty);
  const tile = state.tiles[i] as TileType;
  const has = (t: Exclude<HeroTool, "seeds">) => gatesOpen() || itemCount(HERO_TOOL_ITEM[t]) > 0;
  const need = (label: string) => `You need a ${label} in your stores (craft one by hand)`;
  // Gap closure G6: shears / milk pail on a sheep / cow near the hero; manure fertilises the faced crop tile.
  if (tool === "shears" || tool === "milkPail") {
    const why = heroHandProduct(p, tool);
    return why === "-" ? `No ${tool === "shears" ? "sheep" : "cow"} within reach` : why;
  }
  if (tool === "manure") {
    const why = heroFertilise(i, clan);
    if (why) return why;
    spendEnergy(life, 1);
    gainSkill(p, "farming", 1);
    toast(p, "Fertilised: this crop grows faster until harvested");
    return "";
  }
  if (tool === "axe" || tool === "pick") {
    const kind = gatherKindOf(tile, false);
    if (tool === "axe" ? kind !== "chop" : kind !== "quarry" && kind !== "mine") return tool === "axe" ? "Nothing to chop there" : "No rock or ore there";
    const why = gatherBlock(p, kind!, tx, ty);
    if (why) return why;
    startGather(p, tx, ty, kind!);
    if (b.gather) b.gather.once = once;
    b.tool = undefined;
    return "";
  }
  let act: ToolAct;
  let crop: CropId = CROPS.includes(cropArg as CropId) ? (cropArg as CropId) : "wheat";
  if (tool === "wateringCan" && tile === TileType.Water) {
    if (!has("wateringCan")) return need("watering can");
    if (waterOf(life) >= WATER_CAN_CHARGES) return "Your watering can is full";
    act = "refill";
  } else if (tool === null || tool === "scythe") {
    if (heroCropStage(i) !== CropStage.Ripe) return tool === null ? "-" : "Nothing ripe there";
    if (tool === "scythe" && !has("scythe")) return need("scythe");
    act = "harvest";
  } else {
    act = tool === "hoe" ? "till" : tool === "wateringCan" ? "water" : "sow";
    // Hands on a ripe crop harvest it whatever the tool.
    if (heroCropStage(i) === CropStage.Ripe && act !== "till") act = "harvest";
    else if (tool !== "seeds" && !has(tool)) return need(tool === "hoe" ? "hoe" : "watering can");
  }
  if (act !== "refill") {
    const why = heroFarmCheck(act as "till" | "sow" | "water" | "harvest", i, clan);
    if (why) return why;
  }
  if (act === "water" && waterOf(life) <= 0) return "Your watering can is empty: fill it at water (river or lake)";
  if (act === "sow") {
    crop = heroZoneCrop(i, clan) ?? crop;
    if (!heroZoneCrop(i, clan) && !gatesOpen() && itemCount(SEED_ITEM[crop]) <= 0) return `No ${crop} seeds in your stores (craft them by hand)`;
  }
  if (act === "harvest" && packWeight(life) + PACK_WEIGHT.grain * 6 > PACK_CAP) return "Your pack is full: deposit it at a Town Center or chest, or sell it";
  const secs = act === "harvest" && tool !== "scythe" ? HAND_HARVEST_SECONDS : TOOL_SECONDS[act];
  const total = Math.max(1, Math.round(secs * TICK_RATE));
  b.tool = { tx, ty, act, crop, left: total, total };
  b.gather = undefined;
  b.work = undefined;
  b.resting = false;
  return "";
}

function stepTool(p: Player, b: Busy, t: ToolJob) {
  if (tileCenterDist(p, t.tx, t.ty) > 2.2) {
    b.tool = undefined;
    return;
  }
  const life = lifeOf(p);
  t.left -= skillSpeed(skillLevel(life, "farming")) * energySpeed(life) * heroColdWorkMult(p);
  if (t.left > 0) return;
  b.tool = undefined;
  const clan = p.clan ?? 0;
  const i = tileIndex(t.tx, t.ty);
  if (t.act === "refill") {
    life.water = WATER_CAN_CHARGES;
    return toast(p, "You fill the watering can");
  }
  // The tile may have changed meanwhile (a villager, a building).
  const why = heroFarmCheck(t.act, i, clan);
  if (why) return toast(p, why);
  if (t.act === "sow" && !heroZoneCrop(i, clan) && !gatesOpen() && !takeItem(SEED_ITEM[t.crop], 1)) return toast(p, `No ${t.crop} seeds left`);
  if (t.act === "water") life.water = Math.max(0, waterOf(life) - 1);
  const got = heroFarmApply(t.act, i, clan, t.crop);
  // Agriculture extras: hops went straight into the clan's stores.
  if (got && got.res === "hops") toast(p, `+${got.n} hops (to your stores)`);
  else if (got) {
    const g: PackGood = got.res === "grain" ? "grain" : "cotton";
    const n = Math.max(1, Math.round(got.n));
    life.pack[g] = (life.pack[g] ?? 0) + n;
    toast(p, `+${n} ${PACK_LABEL[g].toLowerCase()}`);
  }
  // Stardew phase 5b: sown out of season (or in winter, outdoors): it waits.
  if (t.act === "sow") {
    const crop = heroZoneCrop(i, clan) ?? t.crop;
    if (cropGrowthMult(crop, roomAtIndex(i) !== null) <= 0) toast(p, `Sown, but ${crop} grows only ${cropSeasonLabel(crop).toLowerCase()} (and not outdoors in winter)`);
  }
  spendEnergy(life, ENERGY_COST[t.act]);
  gainSkill(p, "farming", Math.max(1, ENERGY_COST[t.act]));
}

function findGatherSource(p: Player): { tx: number; ty: number; kind: GatherKind } | null {
  const mx = Math.floor(p.x / TILE_SIZE);
  const my = Math.floor(p.y / TILE_SIZE);
  let best: { tx: number; ty: number; kind: GatherKind; d: number } | null = null;
  for (let ty = my - 1; ty <= my + 1; ty++) {
    for (let tx = mx - 1; tx <= mx + 1; tx++) {
      if (!inBounds(tx, ty)) continue;
      const t = state.tiles[tileIndex(tx, ty)] as TileType;
      const kind = gatherKindOf(t, FORAGE_RIPE_TO_PICKED[t] !== undefined);
      if (!kind) continue;
      const d = tileCenterDist(p, tx, ty);
      if (d <= 1.6 && (!best || d < best.d)) best = { tx, ty, kind, d };
    }
  }
  return best;
}

function findOwnStation(p: Player, target?: { tx: number; ty: number }): { tx: number; ty: number; tile: TileType } | null {
  if (target) {
    if (!inBounds(target.tx, target.ty)) return null;
    const tile = state.tiles[tileIndex(target.tx, target.ty)] as TileType;
    // A layered Mine is worked at its ore face inside only (interiorWorkstation), not from outside.
    return STATION_SKILL[tile] && !isLayeredMine(tile) && clanIdAt(target.tx, target.ty) === p.clan ? { tx: target.tx, ty: target.ty, tile } : null;
  }
  let best: { tx: number; ty: number; tile: TileType } | null = null;
  let bestD = Infinity;
  const mx = Math.floor(p.x / TILE_SIZE);
  const my = Math.floor(p.y / TILE_SIZE);
  for (let ty = my - 2; ty <= my + 2; ty++) {
    for (let tx = mx - 2; tx <= mx + 2; tx++) {
      if (!inBounds(tx, ty)) continue;
      const a = anchorOfTile(tx, ty);
      const tile = state.tiles[tileIndex(a.x, a.y)] as TileType;
      if (STATION_SKILL[tile] && !isLayeredMine(tile) && clanIdAt(a.x, a.y) === p.clan) {
        const d = tileCenterDist(p, a.x, a.y);
        if (d < bestD) { bestD = d; best = { tx: a.x, ty: a.y, tile }; }
      }
    }
  }
  return best;
}

function gatherBlock(p: Player, kind: GatherKind, tx?: number, ty?: number): string {
  const def = GATHER[kind];
  if (def.tool && !gatesOpen() && itemCount(def.tool) <= 0) return `${def.label} needs a ${def.tool === "stoneAxe" ? "stone axe" : "stone pick"} in your stores`;
  // Felling: only the chop that fells the tree needs room for its wood.
  const amount = kind === "chop" && tx !== undefined && ty !== undefined ? (treeChopsDone(tx, ty) + 1 >= treeAt(tx, ty).chops ? treeAt(tx, ty).wood : 0) : def.amount;
  if (packWeight(lifeOf(p)) + amount * PACK_WEIGHT[def.good] > PACK_CAP) return "Your pack is full: deposit it at a Town Center or chest, or sell it";
  return "";
}

function startGather(p: Player, tx: number, ty: number, kind: GatherKind) {
  const b = busyOf(p);
  const why = gatherBlock(p, kind, tx, ty);
  if (why) return toast(p, why);
  const total = Math.round(GATHER[kind].seconds * TICK_RATE);
  b.gather = { tx, ty, kind, left: total, total };
  b.tool = undefined;
  b.work = undefined;
  b.resting = false;
}

export function handleGatherStop(p: Player) {
  busyOf(p).gather = undefined;
}

// ---- hero actions ----
function nearOwnStore(p: Player, tiles: number, chestOnly = false): boolean {
  if(p.interior) return chestOnly ? sharedStockAccess(p) : ownInterior(p);
  for (const tc of clanTownCenters()) if (tileCenterDist(p, tc.x, tc.y) <= tiles + 1) return true;
  const life = lifeOf(p);
  return life.builds.some((b) => b.kind === "chest" && state.tiles[tileIndex(b.x, b.y)] === PERSONAL_BUILDS.chest.tile && tileCenterDist(p, b.x, b.y) <= tiles);
}

export function handleHeroAction(p: Player, action: unknown, build: unknown) {
  if (p.dead) return;
  const life = lifeOf(p);
  const b = busyOf(p);
  if (action === "rest") {
    b.resting = !b.resting;
    b.gather = undefined;
    b.tool = undefined;
    b.work = undefined;
    return toast(p, b.resting ? "You sit down to rest (move to stop)" : "You get up");
  }
  if (action === "dismount") {
    if (!dismountHero(p)) toast(p, "You are on foot");
    return;
  }
  if (action === "stopWork") {
    b.work = undefined;
    return;
  }
  if (action === "eat") {
    if (!eatOnce(p, true)) toast(p, "Nothing to eat in your pack (or your stores, near home)");
    return;
  }
  if (action === "deposit") {
    if (!nearOwnStore(p, 3)) return toast(p, "Stand next to your Town Center or a storage chest to deposit");
    const n = packToStock(life);
    return toast(p, n > 0 ? `Deposited ${n} goods into your stores` : "Your pack is empty");
  }
  if (action === "build" && typeof build === "string" && build in PERSONAL_BUILDS) return personalBuild(p, build as PersonalBuild);
  if (action === "foundCamp") return foundCamp(p);
}

// One unit of the best food: from the pack, else (near home / a chest) from the clan stock. True if eaten.
function eatOnce(p: Player, manual: boolean): boolean {
  const life = lifeOf(p);
  if (life.food >= NEED_MAX - 5 && manual) {
    toast(p, "You are not hungry");
    return true;
  }
  const order = (Object.entries(PACK_FOOD) as [PackGood, number][]).sort((a, b) => b[1] - a[1]);
  for (const [g, v] of order) {
    if ((life.pack[g] ?? 0) > 0) {
      life.pack[g]! -= 1;
      if (life.pack[g] === 0) delete life.pack[g];
      life.food = Math.min(NEED_MAX, life.food + v);
      addEnergy(life, v * ENERGY_PER_FOOD);
      return true;
    }
  }
  if (!nearOwnStore(p, 8)) return false;
  for (const f of [{ id: "bread" as ItemId, v: 35 }, { id: "flatbread" as ItemId, v: 25 }, { id: "gruel" as ItemId, v: 15 }]) {
    if (itemCount(f.id) > 0 && takeItem(f.id, 1)) {
      life.food = Math.min(NEED_MAX, life.food + f.v);
      addEnergy(life, f.v * ENERGY_PER_FOOD);
      return true;
    }
  }
  for (const [k, v] of [["meat", 25], ["fruit", 15], ["grain", 10]] as const) {
    if ((state.stock[k] ?? 0) >= 1) {
      state.stock[k] -= 1;
      life.food = Math.min(NEED_MAX, life.food + v);
      addEnergy(life, v * ENERGY_PER_FOOD);
      return true;
    }
  }
  return false;
}

function personalBuild(p: Player, kind: PersonalBuild) {
  const life = lifeOf(p);
  const def = PERSONAL_BUILDS[kind];
  life.builds = life.builds.filter((b) => state.tiles[tileIndex(b.x, b.y)] === PERSONAL_BUILDS[b.kind].tile);
  if (life.builds.length >= PERSONAL_BUILD_MAX) return toast(p, `You can keep at most ${PERSONAL_BUILD_MAX} personal builds`);
  if (!canPay(life, def.cost)) return toast(p, `A ${def.label.toLowerCase()} needs ${costText(def.cost)}`);
  const spot = freeSpotNextTo(p);
  if (!spot) return toast(p, "No free ground next to you");
  pay(life, def.cost);
  setTile(tileIndex(spot.x, spot.y), def.tile);
  broadcastTileUpdate(spot.x, spot.y, def.tile);
  life.builds.push({ kind, x: spot.x, y: spot.y });
  gainSkill(p, "building", 10);
  toast(p, `You build a ${def.label.toLowerCase()}`);
}

// Costs are paid from the pack first, then the stores (creative: free).
const costText = (cost: Partial<Record<PackGood, number>>) => Object.entries(cost).map(([k, v]) => `${v} ${k}`).join(" + ");
function canPay(life: HeroLife, cost: Partial<Record<PackGood, number>>): boolean {
  if (state.creative) return true;
  return (Object.entries(cost) as [PackGood, number][]).every(([g, n]) => (life.pack[g] ?? 0) + (g === "fish" ? 0 : state.stock[g] ?? 0) >= n);
}
function pay(life: HeroLife, cost: Partial<Record<PackGood, number>>) {
  if (state.creative) return;
  for (const [g, n0] of Object.entries(cost) as [PackGood, number][]) {
    const fromPack = Math.min(n0, life.pack[g] ?? 0);
    if (fromPack > 0) life.pack[g]! -= fromPack;
    if (life.pack[g] === 0) delete life.pack[g];
    if (n0 - fromPack > 0 && g !== "fish") state.stock[g] -= n0 - fromPack;
  }
}
// An empty, unclaimed tile next to the hero with nobody standing on it.
function freeSpotNextTo(p: Player): { x: number; y: number } | null {
  const mx = Math.floor(p.x / TILE_SIZE);
  const my = Math.floor(p.y / TILE_SIZE);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const x = mx + dx;
    const y = my + dy;
    if (inBounds(x, y) && state.tiles[tileIndex(x, y)] === TileType.Empty && ownerAt(tileIndex(x, y)) === 0 && !colonistOn(x, y)) return { x, y };
  }
  return null;
}

// ---- Solo start and founding a camp (phase 4) ----
// resetWorld with `solo` (clan 0 context, after the world is generated): the Town Center and the starting people go,
// the stores hold a little food and gold, the kit is a stone axe, pick and knife, and the hero starts a short walk
// from the human settlement nearest the map centre.
export function applySoloStart() {
  for (const tc of state.townCenters) setTile(tileIndex(tc.x, tc.y), TileType.Empty);
  state.townCenters = [];
  for (const c of Array.from(colonists.values())) if ((c.clan ?? 0) === 0 && c.person) colonists.delete(c.id);
  for (const k of Object.keys(state.stock) as (keyof typeof state.stock)[]) state.stock[k] = 0;
  Object.assign(state.stock, { gold: 30, meat: 3, fruit: 3 });
  addItem("stoneKnife", 1);
  const cx = state.WORLD_TILES_X / 2;
  const cy = state.WORLD_TILES_Y / 2;
  let town: SiteState | null = null;
  for (const s of sites.values()) if (standingTown(s) && (!town || Math.hypot(s.keepX - cx, s.keepY - cy) < Math.hypot(town.keepX - cx, town.keepY - cy))) town = s;
  state.soloSpawn = null;
  if (!town) return;
  for (let r = 6; r <= 30 && !state.soloSpawn; r++) {
    for (let a = 0; a < 24 && !state.soloSpawn; a++) {
      const x = Math.round(town.keepX + r * Math.cos((a * Math.PI) / 12));
      const y = Math.round(town.keepY + r * Math.sin((a * Math.PI) / 12));
      if (inBounds(x, y) && isWalkableTile(x, y) && ownerAt(tileIndex(x, y)) === 0 && tilesToWalls(town, x, y) >= town.apron + 2) state.soloSpawn = { x, y };
    }
  }
  if (state.soloSpawn) revealAround(state.soloSpawn.x, state.soloSpawn.y, circleOffsets(10));
}

// Hero action "foundCamp": with no Town Center of your own, a Town Center next to the hero (FOUND_CAMP_COST) and two
// settlers who join it; from then on the settlement rules (raids, immigrants, builders) apply.
function foundCamp(p: Player) {
  if (clanTownCenters().length > 0) return toast(p, "You already have a Town Center");
  const life = lifeOf(p);
  if (!canPay(life, FOUND_CAMP_COST)) return toast(p, `Founding a camp needs ${costText(FOUND_CAMP_COST)}`);
  const spot = freeSpotNextTo(p);
  if (!spot) return toast(p, "No free, unclaimed ground next to you");
  pay(life, FOUND_CAMP_COST);
  resolveTownCenterPlacement(spot.x, spot.y);
  const tc = state.townCenters.find((t) => t.x === spot.x && t.y === spot.y);
  if (tc) for (let i = 0; i < 2; i++) spawnVillager(tc, newPerson("immigrant"));
  gainSkill(p, "building", 25);
  // The Solo goal track ends here: the normal track starts from its first goal.
  state.goalIndex = 0;
  refreshGoalSnapshot();
  toast(p, "You found a camp: two settlers join you");
}

// sim.ts (the day's raid slot): a Solo hero with no camp gets one lone bandit scout near them, never a raid.
let soloScoutId: string | null = null;
export function spawnSoloScout(dayIndex: number) {
  if (dayIndex < SOLO_SCOUT_FIRST_DAY || (soloScoutId && mobs.has(soloScoutId))) return;
  const p = Array.from(players.values()).find((q) => !q.dead && !q.interior);
  if (!p) return;
  const px = Math.floor(p.x / TILE_SIZE);
  const py = Math.floor(p.y / TILE_SIZE);
  for (let a = 0; a < 16; a++) {
    const x = Math.round(px + SOLO_SCOUT_DIST_TILES * Math.cos((a * Math.PI) / 8));
    const y = Math.round(py + SOLO_SCOUT_DIST_TILES * Math.sin((a * Math.PI) / 8));
    if (!inBounds(x, y) || !isWalkableTile(x, y)) continue;
    soloScoutId = spawnMobAt(SOLO_SCOUT_KIND, x, y)?.id ?? null;
    if (soloScoutId) toast(p, "A lone bandit scout is prowling near you");
    return;
  }
}

function colonistOn(tx: number, ty: number): boolean {
  for (const c of colonists.values()) if (Math.floor(c.x / TILE_SIZE) === tx && Math.floor(c.y / TILE_SIZE) === ty) return true;
  return false;
}

// Rest multiplier from shelter: own lean-to x3 (2 tiles), campfire x2 (3 tiles), own house / Town Center x3.
function shelterMult(p: Player): number {
  const life = lifeOf(p);
  let m = 1;
  for (const b of life.builds) {
    if (state.tiles[tileIndex(b.x, b.y)] !== PERSONAL_BUILDS[b.kind].tile) continue;
    const d = tileCenterDist(p, b.x, b.y);
    if (b.kind === "leanTo" && d <= 2) m = Math.max(m, 3);
    if (b.kind === "campfire" && d <= 3) m = Math.max(m, 2);
  }
  if (m < 3 && !p.interior && nearOwnStore(p, 2)) m = 3;
  // Modular building phase 2: resting in a bedroom (x its quality, shared/src/rooms.ts).
  m = Math.max(m, heroRestMultAt(p.x, p.y));
  // Stardew phase 5c: in your own house / hall interior (your bed).
  m = Math.max(m, interiorRestMult(p));
  return m;
}

// Stardew phase 5b: winter rest multipliers (gain while resting, decay otherwise); 1 / 1 outside winter.
function coldMult(p: Player): { gain: number; decay: number } {
  // Stardew phase 5c: indoors (any building interior) is out of the cold. Winter (winter.ts): unless it is a home
  // left without fuel today (poorer rest).
  if (!winterNow()) return { gain: 1, decay: 1 };
  if (p.interior) return { gain: heroColdRestGain(p), decay: 1 };
  if (warmRoomAt(Math.floor(p.x / TILE_SIZE), Math.floor(p.y / TILE_SIZE))) return { gain: WINTER_WARM_ROOM_REST_MULT, decay: 1 };
  if (!isNightNow() || shelterMult(p) > 1) return { gain: 1, decay: 1 };
  return { gain: WINTER_COLD_REST_GAIN_MULT, decay: WINTER_COLD_REST_DECAY_MULT };
}

// ---- per tick (sim.ts) ----
const FOOD_DECAY_PER_S = 100 / (1.5 * 375);
const REST_DECAY_PER_S = 100 / 375;
const REST_GAIN_PER_S = 1;
const REGEN_FRAC_PER_S = 0.005;
const HURT_CALM_TICKS = 8 * TICK_RATE;

export function updateHeroLife() {
  const second = state.cycleTick % TICK_RATE === 0;
  for (const p of players.values()) {
    const b = busy.get(p.id);
    if (p.dead) {
      if (b) {
        b.gather = undefined;
        b.tool = undefined;
        b.work = undefined;
        b.resting = false;
        if (b.talk) closeTalk(p);
      }
      continue;
    }
    if (!b && !second) continue;
    withClan(clanOf(p), () => stepPlayer(p, busyOf(p), second));
  }
  for (const id of busy.keys()) if (!players.has(id)) busy.delete(id);
}

function stepPlayer(p: Player, b: Busy, second: boolean) {
  const moving = p.input.dx !== 0 || p.input.dy !== 0;
  if (p.hp < b.lastHp) b.hurtTick = state.cycleTick;
  b.lastHp = p.hp;
  if (moving) {
    b.gather = undefined;
    b.work = undefined;
    b.resting = false;
  }
  if (b.talk && second && !talkInRange(p, b.talk)) closeTalk(p);
  if (b.gather) stepGather(p, b, b.gather);
  if (b.tool) stepTool(p, b, b.tool);
  if (b.work && isMounted(p)) b.work = undefined;
  if (b.work) stepWork(p, b, b.work);
  if (second) stepNeeds(p, b);
}

function stepGather(p: Player, b: Busy, g: GatherJob) {
  const i = tileIndex(g.tx, g.ty);
  const tile = state.tiles[i] as TileType;
  if (gatherKindOf(tile, FORAGE_RIPE_TO_PICKED[tile] !== undefined) !== g.kind || tileCenterDist(p, g.tx, g.ty) > 1.8) {
    b.gather = undefined;
    return;
  }
  const def = GATHER[g.kind];
  const life = lifeOf(p);
  // Industry extras: bronze tools in the stores (felling, quarrying, mining).
  const bronze = g.kind === "chop" || g.kind === "quarry" || g.kind === "mine" ? bronzeToolMult("hero") : 1;
  g.left -= skillSpeed(skillLevel(life, def.skill)) * energySpeed(life) * heroColdWorkMult(p) * bronze;
  if (g.left > 0) return;
  // Felling (2026-11-19): a chop gives no wood; the tree falls after treeAt().chops chops and pays out then.
  const amount = g.kind === "chop" ? treeAt(g.tx,g.ty).wood : def.amount;
  const fells = g.kind !== "chop" || treeChopsDone(g.tx, g.ty) + 1 >= treeAt(g.tx, g.ty).chops;
  if (fells && packWeight(life)+amount*PACK_WEIGHT[def.good]>PACK_CAP) { b.gather=undefined; return toast(p,"Your pack is full"); }
  if (g.kind === "chop") chopTree(g.tx, g.ty);
  if (fells) life.pack[def.good] = (life.pack[def.good] ?? 0) + amount;
  gainSkill(p, def.skill, def.seconds);
  spendEnergy(life, g.kind === "chop" ? ENERGY_COST.chop : g.kind === "mine" || g.kind === "quarry" ? ENERGY_COST.mine : 0);
  if (g.kind === "chop" && fells) {
    toast(p, `${treeAt(g.tx, g.ty).name} felled: +${amount} wood`);
    b.gather = undefined;
    return;
  } else if (g.kind === "forage") {
    const picked = FORAGE_RIPE_TO_PICKED[tile]!;
    setTile(i, picked);
    broadcastTileUpdate(g.tx, g.ty, picked);
    forageRegrow.set(i, FORAGE_REGROW_TICKS);
  }
  if (g.once) {
    b.gather = undefined;
    return;
  }
  // Held: the next one starts at once if the source and the pack allow it.
  const why = gatherBlock(p, g.kind, g.tx, g.ty);
  if (why) {
    b.gather = undefined;
    toast(p, why);
    return;
  }
  g.left = g.total;
}

// The hero as a station's worker: the first ready recipe at the hero's skill level, inputs from the stores, output
// grade = min(station level, skill level), speed by that tier; 1 XP per second of the batch, granted on completion once the inputs are paid.
function stepWork(p: Player, b: Busy, w: WorkJob) {
  const st = personalStation(p,w);
  if(!st || st.tx!==w.tx || st.ty!==w.ty || st.tile!==w.tile || p.interior?.key!==w.insideKey) { b.work=undefined; return; }
  if(!w.job) { b.work=undefined; return; }
  const life=lifeOf(p), tier=Math.min(skillLevel(life,w.skill),Math.max(1,getBuildingLevel(w.tx,w.ty)));
  // Layered mines: bad air and bronze tools pace the hero's digging like the miners'.
  w.job.left-=skillSpeed(tier)*energySpeed(life)*heroColdWorkMult(p)*(w.job.recipe.mineLayer?mineHeroDigSpeed(w.tx,w.ty,p):1);
  if(w.job.left>0)return;
  const r=w.job.recipe,why=personalRecipeBlock(p,r,st);
  b.work=undefined;
  if(why)return toast(p,why);
  if(r.mineLayer){
   // Ore is ungraded (grade 1, as the miners dig it); an unpropped shaft may cave in on the batch.
   const caveIn=mineHeroCaveIn(p,w.tx,w.ty,r.mineLayer);
   if(caveIn)return toast(p,caveIn);
   if(r.item)addItem(r.item,r.amount);
   if(r.stockOutput)state.stock[r.stockOutput]+=r.amount;
   gainSkill(p,w.skill,Math.max(1,Math.round(w.job.total/TICK_RATE)));
   spendEnergy(life,2);
   return toast(p,`${r.label} complete: +${r.amount} to your stockpile.`);
  }
  // Pay and produce together: interrupted work never destroys inputs, simultaneous crafters cannot double-spend.
  if(!state.creative)for(const[k,n]of Object.entries(r.stock??{}))state.stock[k as ResourceKey]-=n??0;
  for(const[id,n]of Object.entries(r.items??{}))takeItem(id as ItemId,n??0);
  if(r.questGear)grantStoryShield(p,r.id==='hesta-shield'?'Hestas Riveted Shield':'Dains Watch Shield');
  if(r.item)produceItem(r.item,r.amount,Math.min(3,tier+(r.gradeBonus??0)));
  if(r.stockOutput)state.stock[r.stockOutput]+=r.amount;
  // Industry extras: Fine steel in store forges each piece a tier better (forgedTier).
  if(r.gear)for(let i=0;i<r.amount;i++)state.equipment[r.gear][forgedTier(r.tier!)-1]++;
  gainSkill(p,w.skill,Math.max(1,Math.round(w.job.total/TICK_RATE)));
  spendEnergy(life,2);
  storyEvent(p,'craft',r.item??r.stockOutput??r.id);
  toast(p,`${r.label} complete. Added to your ${r.questGear?'equipment inventory':'stockpile'}.`);
}

function stepNeeds(p: Player, b: Busy) {
  if (!needsOn()) return;
  const life = lifeOf(p);
  life.food = Math.max(0, life.food - FOOD_DECAY_PER_S);
  // Stardew phase 5b: a winter night out in the cold (no warm room, no shelter) tires the hero; a warm room rests more.
  const cold = coldMult(p);
  if (b.resting) {
    const mult = shelterMult(p) * cold.gain;
    life.rest = Math.min(NEED_MAX, life.rest + REST_GAIN_PER_S * mult);
    addEnergy(life, ENERGY_REST_PER_S * mult);
  } else life.rest = Math.max(0, life.rest - REST_DECAY_PER_S * cold.decay * (isMounted(p) ? MOUNT_REST_DECAY_MULT : 1));
  if (life.food < AUTO_EAT_BELOW) eatOnce(p, false);
  // Natural healing: fed, rested and out of the fight for a while (x4 resting).
  const ok = life.food >= NEED_LOW && life.rest >= NEED_LOW;
  if (ok && state.cycleTick - b.hurtTick >= HURT_CALM_TICKS) {
    const max = playerMaxHp(p);
    if (p.hp < max) {
      // Gap closure G1: resting in an infirmary heals faster still.
      p.hp = Math.min(max, p.hp + max * REGEN_FRAC_PER_S * (b.resting ? 4 * heroInfirmaryHealMult(p.x, p.y) : 1));
      b.lastHp = p.hp;
    }
  }
}

// sim.ts: the hero's speed multiplier (needs and load).
export function heroSpeedMult(p: Player): number {
  const life = heroProfileOf(p).life;
  if (!life) return 1;
  let m = 1;
  const load = packWeight(life) / PACK_CAP;
  if (load > 0.5) m *= 1 - 0.5 * Math.min(0.5, load - 0.5);
  if (needsOn()) {
    if (life.food < NEED_LOW) m *= 0.8;
    if (life.rest < NEED_LOW) m *= 0.8;
  }
  // Gap closure G6: riding (outdoors only: a rider cannot enter interiors).
  if (isMounted(p)) m *= MOUNT_SPEED_MULT;
  // Winter: out in the cold without warm clothes (winter.ts).
  m *= heroColdSpeedMult(p);
  return m;
}

// combat.ts: a wildlife kill by the player (hunting XP).
export function noteHeroHunt(p: Player) {
  gainSkill(p, "hunting", 10);
}

const clanTownCentersOf = (p: Player) => townCentersOfClan(p.clan ?? 0);

// ---- snapshot ----
function lifeSnapshot(p: Player): HeroLifeSnapshot {
  const life = lifeOf(p);
  const b = busy.get(p.id);
  const slow: string[] = [];
  if (needsOn() && life.food < NEED_LOW) slow.push("Hungry");
  if (needsOn() && life.rest < NEED_LOW) slow.push("Tired");
  if (packWeight(life) / PACK_CAP > 0.5) slow.push("Heavy load");
  if (needsOn() && energyOf(life) <= 0) slow.push("Exhausted (half-speed work)");
  // Winter: out in the cold without warm clothes (a coat, or a tunic and boots from the Tailor).
  if (heroCold(p)) slow.push("Freezing: no warm clothes (slower work and walking)");
  const questMarks = questMarksFor(p.clan ?? 0);
  return {
    pack: life.pack,
    weight: packWeight(life),
    cap: PACK_CAP,
    food: Math.round(life.food),
    rest: Math.round(life.rest),
    needs: needsOn(),
    skills: HERO_SKILLS.map((id) => {
      const xp = Math.floor(life.skills[id] ?? 0);
      return { id, level: levelForXp(xp), xp, next: xpToNext(xp) };
    }),
    ...(b?.gather ? { gather: { label: b.gather.kind === "chop" ? `${GATHER.chop.label} ${treeChopsDone(b.gather.tx, b.gather.ty) + 1}/${treeAt(b.gather.tx, b.gather.ty).chops}` : GATHER[b.gather.kind].label, p: Math.round(100 * (1 - b.gather.left / b.gather.total)) / 100 } } : {}),
    ...(b?.tool ? { gather: { label: TOOL_ACT_LABEL[b.tool.act], p: Math.round(100 * (1 - b.tool.left / b.tool.total)) / 100 } } : {}),
    energy: Math.round(energyOf(life)),
    water: waterOf(life),
    ...(b?.work ? { work: { label: b.work.job ? b.work.job.recipe.label : `Idle: ${b.work.idle ?? "..."}`, p: b.work.job ? Math.round(100 * (1 - b.work.job.left / b.work.job.total)) / 100 : 0 } } : {}),
    ...(b?.resting ? { resting: true } : {}),
    ...(slow.length ? { slow } : {}),
    builds: life.builds.length,
    ...(clanTownCentersOf(p).length === 0 ? { canFound: true } : {}),
    ...(cachedFamilySnapshot(p) ? { family: cachedFamilySnapshot(p) } : {}),
    ...(questMarks.length ? { questMarks } : {}),
  };
}

// index.ts: appended to this player's snapshot when it changed.
export function withPlayerLife(payload: string, p: Player): string {
  const b = busyOf(p);
  const json = JSON.stringify(lifeSnapshot(p));
  if (json === b.sent) return payload;
  b.sent = json;
  return payload.slice(0, -1) + ',"life":' + json + "}";
}

// Stardew phase 5c: entering / leaving an interior drops gathering, tool use, station work and the conversation.
export function stopHeroBusy(p: Player) {
  const b = busy.get(p.id);
  if (!b) return;
  b.gather = undefined;
  b.tool = undefined;
  b.work = undefined;
  b.resting = false;
  if (b.talk) closeTalk(p);
}
// Interiors: the bed's nap (resting, x the bed's multiplier) / a full night's sleep.
export function setHeroResting(p: Player, on: boolean) {
  const b = busyOf(p);
  b.resting = on;
  b.gather = undefined;
  b.tool = undefined;
  b.work = undefined;
}
export function restHeroFully(p: Player) {
  const life = lifeOf(p);
  life.rest = NEED_MAX;
  life.energy = ENERGY_MAX;
}

// A new world / load: transient work is dropped and every player's life is resent.
export function resetHeroLifeSessions() {
  busy.clear();
  resetFamilyCache();
}

// ---- creative / test hooks ----
export function setHeroSkills(p: Player, level: number) {
  const life = lifeOf(p);
  for (const k of HERO_SKILLS) life.skills[k] = skillXpFor(Math.max(1, Math.min(4, level)));
}
export function fillHeroPack(p: Player) {
  const life = lifeOf(p);
  life.pack = { wood: 10, rock: 5, meat: 4, fruit: 4 };
  life.food = NEED_MAX;
  life.rest = NEED_MAX;
  life.energy = ENERGY_MAX;
  life.water = WATER_CAN_CHARGES;
}
export function heroLifeDebug(p: Player) {
  const b = busy.get(p.id);
  return { life: lifeOf(p), snap: lifeSnapshot(p), tool: b?.tool ? { act: b.tool.act, left: b.tool.left, total: b.tool.total } : null, gathering: b?.gather ? { kind: b.gather.kind, once: !!b.gather.once } : null, family: familySnapshot(p, heirOrderNames), needsOn: needsOn(), talking: b?.talk ? { role: b.talk.role, name: b.talk.name, choices: b.talk.choices.map((c) => c.label) } : null, speed: heroSpeedMult(p) };
}

// Player crafting uses the existing progression, artisan and forge definitions.
interface PersonalRecipe {
 id:string; label:string; amount:number; seconds:number; level?:number; tier?:number; stationLevel?:number;
 stock?:Partial<Record<ResourceKey,number>>; stockReserve?:Partial<Record<ResourceKey,number>>; items?:Partial<Record<ItemId,number>>; needs?:Partial<Record<ItemId,number>>;
 questGear?:'shield'; item?:ItemId; stockOutput?:ResourceKey; gear?:'armour'|'weapon'; gradeBonus?:number;
 // The station's production cap on the output (items: the recipe's cap; stock: the artisan's stockCap). The hero's own
 // batch stops there too: no uncapped fallback (2026-11-20).
 cap?:number;
 // Layered mines: a dig at the ore face of this layer (1-3; mines.ts mineDigRecipes / mineDigBlock).
 mineLayer?:number;
}
// The batches the hero can make at a station: a layered Mine's ore face (inside only) digs the layer the hero is on.
function personalRecipes(p:Player,st:{tx:number;ty:number;tile:TileType}):PersonalRecipe[] {
 if(!isLayeredMine(st.tile))return [...playerStationRecipes(st.tile),...STORY_RECIPES.filter(r=>r.station===st.tile&&lifeOf(p).flags[`recipe:${r.id}`])];
 const layer=(p.interior?.variant??0)+1;
 return p.interior?mineDigRows(st.tx,st.ty,layer).map(d=>({id:`mine:${layer}:${d.res}`,label:`Dig ${d.label}`,amount:MINE_HERO_DIG_AMOUNT,seconds:MINE_HERO_DIG_SECONDS,
  needs:gatesOpen()?undefined:{[d.pick]:1},item:d.res==='iron'?undefined:d.res,stockOutput:d.res==='iron'?'iron':undefined,cap:d.cap,mineLayer:layer})):[];
}
function personalStation(p:Player,target?:{tx:number;ty:number}) {
 if(p.interior)return interiorWorkstation(p);
 const st=findOwnStation(p,target);
 return st && ownerAt(tileIndex(st.tx,st.ty))===0 && clanIdAt(st.tx,st.ty)===(p.clan??0) && tileCenterDist(p,st.tx,st.ty)<=3 ? st:null;
}
export function playerStationRecipes(tile:TileType):PersonalRecipe[] {
 const rows:PersonalRecipe[]=stationRecipes(tile).map(r=>({id:r.id,label:r.label,amount:r.amount,seconds:r.seconds??30,level:r.workerLevel,stationLevel:r.stationLevel,gradeBonus:r.gradeBonus,stock:r.stock,stockReserve:r.stockReserve,items:r.items,needs:r.needs,item:r.output,cap:r.cap??outputCap(r.output)}));
 const r=CRAFT_RECIPES[tile];
 if(r)rows.push({id:'artisan:'+tile,label:({clothes:'Sew clothes',tools:'Forge tools',luxuryItems:'Craft luxury goods',alcohol:'Brew ale',gold:'Serve drinks'} as Record<string,string>)[r.output]??r.output,amount:r.outputAmount??1,seconds:30,stock:r.inputs,stockOutput:r.output,cap:r.stockCap});
 if(tile===TileType.Blacksmith)for(const tier of [1,2,3])for(const gear of ['weapon','armour'] as const)rows.push({id:`forge:${gear}:${tier}`,label:`Forge tier ${tier} ${forgeItems(gear,tier).bronze?'bronze ':''}${gear==='weapon'?'weapons':'armour'}`,level:gatesOpen()?undefined:smithLevelForGearTier(tier),amount:1,seconds:FORGE_TICKS[gear]/TICK_RATE,tier,stock:forgeCost(gear,tier),items:forgeItems(gear,tier),gear});
 return rows;
}
function personalRecipeBlock(p:Player,r:PersonalRecipe,st:{tx:number;ty:number;tile:TileType}):string {
 if(r.questGear&&heroProfileOf(p).inventory.length>=40)return "Your equipment inventory is full; no materials have been taken";
 if(r.tier && getBuildingLevel(st.tx,st.ty)<r.tier)return `Upgrade the blacksmith to level ${r.tier}`;
 if(r.stationLevel && getBuildingLevel(st.tx,st.ty)<r.stationLevel)return `Upgrade the station to level ${r.stationLevel}`;
 if(skillLevel(lifeOf(p),STATION_SKILL[st.tile]!)<(r.level??1))return `Needs skill level ${r.level}`;
 if(r.mineLayer){const why=mineDigBlock(st.tx,st.ty,r.mineLayer);if(why)return why;}
 if(r.cap!==undefined){
  const have=r.item?itemCount(r.item):r.stockOutput?Math.floor(state.stock[r.stockOutput]??0):0;
  if(have>=r.cap)return `${r.item?PROGRESSION.items[r.item].label:r.stockOutput}: ${have} in store (enough: the cap is ${r.cap})`;
 }
 for(const[k,n]of Object.entries(r.stock??{}))if(!state.creative&&state.stock[k as ResourceKey]<(n??0)+(r.stockReserve?.[k as ResourceKey]??0))return `Not enough ${k} in stockpile`;
 for(const id of new Set([...Object.keys(r.items??{}),...Object.keys(r.needs??{})]) as Set<ItemId>)if(itemCount(id)<Math.max(r.items?.[id]??0,r.needs?.[id]??0))return `Needs ${PROGRESSION.items[id].label}`;
 return '';
}
export function handlePersonalCraft(p:Player,id?:string,target?:{tx:number;ty:number}) {
 if(p.dead||isMounted(p))return;
 const st=personalStation(p,target);
 if(!st)return toast(p,'Walk up to your workstation: an anvil, oven or workbench inside, or the workshop outside.');
 const recipes=personalRecipes(p,st);
 if(id){
  const r=recipes.find(r=>r.id===id);if(!r)return toast(p,'This recipe needs a different workstation');
  const why=personalRecipeBlock(p,r,st);if(why)return toast(p,why);
  const b=busyOf(p);if(b.work?.job)return toast(p,'Finish this batch, or move to cancel it first');
  const total=Math.max(1,Math.round(r.seconds*TICK_RATE));
  b.work={...st,insideKey:p.interior?.key,skill:STATION_SKILL[st.tile]!,job:{recipe:r,left:total,total}};
  b.gather=undefined;b.tool=undefined;b.resting=false;closeTalk(p);
  return toast(p,`${r.label}: working (move to cancel). Inputs and output use your stockpile.`);
 }
 const I=p.interior;
 const at:TalkInside=I?{key:I.key,x:I.x,y:I.y,anchor:{x:st.tx,y:st.ty}}:{world:true,key:`${st.tx},${st.ty}`,x:(st.tx+.5)*TILE_SIZE,y:(st.ty+.5)*TILE_SIZE,anchor:{x:st.tx,y:st.ty}};
 const panel:ChoiceRt[]=I?[]:[{label:'Building panel',action:'openBuilding'}];
 furnitureTalk(p,'Craft at workstation','Choose a batch to make yourself. Stay at the station while you work. Inputs are taken only when the batch completes; output goes to your stockpile.',([...recipes.map(r=>({label:`${r.label} ×${r.amount} — ${r.seconds}s; ${[...Object.entries(r.stock??{}),...Object.entries(r.items??{})].map(([k,n])=>`${n} ${k}`).join(' + ')}`,action:'craftRecipe' as const,arg:r.id,disabled:personalRecipeBlock(p,r,st)||undefined})),...panel] as ChoiceRt[]),at);
}
export function handleStockWithdraw(p:Player,good:unknown,amount:unknown){
 if(p.dead||isMounted(p)||!nearOwnStore(p,3,true))return toast(p,'Stand beside your stockpile chest or Town Hall (dismount first)');
 if(typeof good!=='string'||!PACK_GOODS.includes(good as PackGood)||good==='fish'||typeof amount!=='number'||!Number.isInteger(amount)||amount<1||amount>999)return;
 const g=good as Exclude<PackGood,'fish'>,life=lifeOf(p);
 const n=Math.max(0,Math.min(amount,Math.floor(state.stock[g]??0),Math.floor((PACK_CAP-packWeight(life)+1e-9)/PACK_WEIGHT[g])));
 state.stock[g]=(state.stock[g]??0)-n;life.pack[g]=(life.pack[g]??0)+n;
 toast(p,n?`Took ${n} ${PACK_LABEL[g].toLowerCase()} from stockpile`:'No room, or none in stockpile');
}
