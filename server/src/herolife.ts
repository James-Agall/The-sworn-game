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
  PACK_WEIGHT, PERSONAL_BUILDS, PERSONAL_BUILD_MAX, STATION_SKILL, TALK_RANGE_TILES, TREE_FELL_CHANCE,
  ENERGY_COST, ENERGY_EMPTY_SPEED, ENERGY_MAX, ENERGY_PER_FOOD, ENERGY_REST_PER_S, HAND_HARVEST_SECONDS, HERO_TOOLS, HERO_TOOL_ITEM,
  SEED_ITEM, TOOL_ACT_LABEL, TOOL_SECONDS, WATER_CAN_CHARGES,
  type DialogueAction, type DialogueSnapshot, type GatherKind, type HeroLifeSnapshot, type HeroSkill, type HeroTool, type NpcRole,
  type PackGood, type PersonalBuild, type ToolAct, gatherKindOf, skillSpeed, skillXpFor,
} from "@colony/shared/herolife";
import { CROPS, CropStage, type CropId } from "@colony/shared/zones";
import { heroCropStage, heroFarmApply, heroFarmCheck, heroFertilise, heroZoneCrop } from "./zones.js";
import { type ItemId, type Recipe, PROFESSION_LABEL, levelForXp, stationRecipes, xpToNext } from "@colony/shared/progression";
import type { Colonist, HeroLife, Mob, Player, SiteState } from "./types.js";
import { FORAGE_RIPE_TO_PICKED, FORAGE_REGROW_TICKS, QUEST_MAX_PER_SITE, RELATION_ALLIED_MIN } from "./constants.js";
import { colonists, forageRegrow, hearths, mobs, players, sites, state } from "./state.js";
import { anchorOfTile, getBuildingLevel, inBounds, isNightNow, ownerAt, tileIndex } from "./tiles.js";
import { isWalkableTile } from "./pathfinding.js";
import { resolveTownCenterPlacement } from "./construction.js";
import { newPerson, spawnVillager } from "./colonists.js";
import { setTile } from "./chunks.js";
import { broadcastTileUpdate, circleOffsets, revealAround } from "./net.js";
import { sendTo } from "./saves.js";
import { clanIdAt, clanOf, clanTownCenters, townCentersOfClan, withClan } from "./clans.js";
import { gameDay, handleTradeWithSite, standingTown, tierOf, tilesToWalls } from "./diplomacy.js";
import { adjustRelation, relationOf } from "./sites.js";
import { forcePostQuest, handleQuestMessage, quests, questsForSnapshot } from "./quests.js";
import { addItem, gatesOpen, itemCount, professionOf, recipeReady, stationIdleReason, takeItem, workerLevel } from "./progression.js";
import { heroProfileOf, playerMaxHp } from "./heroes.js";
import {
  bringKinHome, cachedFamilySnapshot, courtable, familyOf, familySnapshot, heroTaken, kinBond, kinRelation, marry, partWays, resetFamilyCache,
} from "./family.js";
import { handleCallToArms } from "./vassals.js";
import { heirOrderNames } from "./people.js";
import { cropGrowthMult, winterNow } from "./calendar.js";
import { cropSeasonLabel, WINTER_COLD_REST_DECAY_MULT, WINTER_COLD_REST_GAIN_MULT, WINTER_WARM_ROOM_REST_MULT } from "@colony/shared/calendar";
import { interiorFurnitureChoice, interiorInteract, interiorRestMult, tryEnterAtDoor } from "./interiors.js";

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
  job?: { recipe: Recipe; left: number; total: number };
  idle?: string;
}
export interface ChoiceRt {
  label: string;
  disabled?: string;
  next?: string;
  action?: DialogueAction | "accept" | "deliver" | "learn" | "back" | "pick" | "sellAnimal";
  arg?: number | string;
}
// Stardew phase 5c: a talk inside a building interior (the NPC / bed / chest stands at interior px x / y of the
// interior `key`; range is measured there) and the building it is in (openBuilding).
export interface TalkInside {
  key: string;
  x: number;
  y: number;
  anchor: { x: number; y: number };
}
interface Talk {
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
const NAMES = ["Aldric", "Bryn", "Cedda", "Dunstan", "Edith", "Godric", "Hilda", "Ivo", "Maud", "Osric", "Rowena", "Sigrid", "Tamsin", "Wulf", "Agnes", "Bertram"];
function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
export const nameFor = (id: string) => NAMES[hashOf(id) % NAMES.length];
export const talkColorFor = (name: string) => [0xc9a227, 0x6aa84f, 0x8e7cc3, 0xe69138, 0x3d85c6][hashOf(name) % 5];

// ---- talk ----
export interface Target {
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
    const role: NpcRole = m.siteWorker === "priest" ? "questGiver" : s.workers[0] === m.id ? "trader" : "villager";
    offer({ role, name: `${role === "questGiver" ? "Brother " : ""}${nameFor(m.id)}`, d: Math.hypot(m.x - p.x, m.y - p.y) / TILE_SIZE, site: s, mob: m });
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

function fill(text: string, t: Talk, tier?: RelationTier): string {
  const site = t.siteId ? sites.get(t.siteId)?.name ?? "" : "";
  return text.replaceAll("{npc}", t.name).replaceAll("{site}", site).replaceAll("{tier}", tier ?? "");
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
  if (a === "sellAnimals" && animalsForSale(p.clan ?? 0).length === 0) return "You have no animals to sell";
  return "";
}

function renderTalk(p: Player, t: Talk, nodeId: string, prefix = "") {
  const s = siteOf(t);
  const tier = s ? tierOf(p.clan, s) : undefined;
  const node = DIALOGUE[t.role][nodeId] ?? DIALOGUE[t.role].start;
  const raw = (tier && node.text[tier]) ?? node.text.default ?? node.text.neutral ?? "";
  t.choices = node.choices
    .filter((c) => !c.tiers || (tier && c.tiers.includes(tier)))
    .map((c) => ({ label: fill(c.label, t, tier), next: c.next, action: c.action, disabled: c.action ? actionBlock(p, t, c.action) || undefined : undefined }));
  if (nodeId === "start") {
    const extra = familyChoices(p, t);
    if (extra.length) t.choices.splice(t.choices.length - 1, 0, ...extra);
  }
  sendTalk(p, t, (prefix ? prefix + "\n\n" : "") + fill(raw, t, tier));
}

function sendTalk(p: Player, t: Talk, text: string) {
  const s = siteOf(t);
  const dialogue: DialogueSnapshot = {
    npc: { name: t.name, role: t.role, roleLabel: NPC_ROLE_LABEL[t.role], ...(s ? { site: s.name, tier: tierOf(p.clan, s) } : {}), color: t.color },
    text,
    choices: t.choices.map((c) => ({ label: c.label, ...(c.disabled ? { disabled: c.disabled } : {}) })),
  };
  sendTo(p, { type: "dialogue", dialogue });
}

export function closeTalk(p: Player, extra: { openTrade?: { tileX: number; tileY: number } } = {}) {
  busyOf(p).talk = undefined;
  sendTo(p, { type: "dialogue", close: true, ...extra });
}

// A node with a line of result and Back / Farewell.
function sayThen(p: Player, t: Talk, text: string, more: ChoiceRt[] = []) {
  t.choices = [...more, { label: "Back.", action: "back" }, { label: "Farewell.", action: "bye" }];
  sendTalk(p, t, text);
}

export function startTalk(p: Player, target: Target) {
  const t: Talk = {
    role: target.role, name: target.name, siteId: target.site?.id, mobId: target.mob?.id, colonistId: target.colonist?.id,
    color: talkColorFor(target.name), choices: [], ...(target.inside ? { inside: target.inside } : {}),
  };
  busyOf(p).talk = t;
  const life = lifeOf(p);
  if (target.site) life.flags[`met:${target.site.id}`] = gameDay();
  renderTalk(p, t, "start");
}

// Stardew phase 5c: a bed / chest inside an interior, spoken to like an NPC (choices built by interiors.ts).
export function furnitureTalk(p: Player, name: string, text: string, choices: ChoiceRt[], inside: TalkInside) {
  const b = busyOf(p);
  const t: Talk = b.talk?.role === "furniture" && b.talk.name === name ? b.talk : { role: "furniture", name, color: 0x8a5a2b, choices: [], inside };
  t.choices = [...choices, { label: "Close.", action: "bye" }];
  b.talk = t;
  sendTalk(p, t, text);
}

// Still in talking range of the NPC (it may walk off or die).
function talkInRange(p: Player, t: Talk): boolean {
  // Stardew phase 5c: inside an interior the distance is measured there (the NPC's world body may be anywhere).
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
    case "rumour":
      if (s) life.flags[`rumour:${s.id}`] = day;
      gainSkill(p, "speech", 3);
      return sayThen(p, t, rumourAbout(p));
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
    case "quests":
      return s ? showQuests(p, t, s, "") : closeTalk(p);
    case "accept":
    case "deliver": {
      if (!s) return closeTalk(p);
      if (c.action === "deliver") packToStock(life, c.arg as string);
      const why = handleQuestMessage(p, c.action === "accept" ? "acceptQuest" : "deliverQuest", c.arg === undefined ? undefined : Number(String(c.arg).split(":")[0]));
      if (!why) gainSkill(p, "speech", 5);
      return showQuests(p, t, s, why || (c.action === "accept" ? "\"Thank you. Come back when it is done.\"" : "\"Just what we needed.\""));
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
    case "openBuilding":
      return t.inside ? closeTalk(p, { openTrade: { tileX: t.inside.anchor.x, tileY: t.inside.anchor.y } }) : closeTalk(p);
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

// The settlement posts this clan a quest now if it can (its cooldown and the per-settlement cap apply).
function askForWork(p: Player, t: Talk, s: SiteState) {
  gainSkill(p, "speech", 3);
  const open = quests.filter((q) => q.clan === p.clan && q.siteId === s.id).length;
  if (open >= QUEST_MAX_PER_SITE) return showQuests(p, t, s, "\"You have our work already.\"");
  if ((s.diplo?.[p.clan]?.questNextTick ?? 0) > state.cycleTick) return showQuests(p, t, s, "\"Nothing new yet. Come back in a day or so.\"");
  const kinds = isNightNow() ? (["defend", "clearCamp", "deliver"] as const) : (["clearCamp", "deliver"] as const);
  for (const k of kinds) if (typeof forcePostQuest(s.id, p.clan, k) !== "string") return showQuests(p, t, s, "\"As it happens, there is something.\"");
  return showQuests(p, t, s, "\"We need nothing right now. Thank you for asking.\"");
}

function showQuests(p: Player, t: Talk, s: SiteState, head: string) {
  const mine = questsForSnapshot(p.clan).filter((q) => q.siteNum === s.num);
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
  const b = busyOf(p);
  const near = talkTargets(p);
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
    b.work = { tx: st.tx, ty: st.ty, tile: st.tile, skill: STATION_SKILL[st.tile]! };
    b.resting = false;
    return toast(p, `You take up the work at the ${HERO_SKILL_LABEL[b.work.skill].toLowerCase()} station (move to stop)`);
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
    const why = gatherBlock(p, kind!);
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
  t.left -= skillSpeed(skillLevel(life, "farming")) * energySpeed(life);
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
  if (got) {
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

function findOwnStation(p: Player): { tx: number; ty: number; tile: TileType } | null {
  const mx = Math.floor(p.x / TILE_SIZE);
  const my = Math.floor(p.y / TILE_SIZE);
  for (let ty = my - 2; ty <= my + 2; ty++) {
    for (let tx = mx - 2; tx <= mx + 2; tx++) {
      if (!inBounds(tx, ty)) continue;
      const a = anchorOfTile(tx, ty);
      const tile = state.tiles[tileIndex(a.x, a.y)] as TileType;
      if (STATION_SKILL[tile] && clanIdAt(a.x, a.y) === p.clan) return { tx: a.x, ty: a.y, tile };
    }
  }
  return null;
}

function gatherBlock(p: Player, kind: GatherKind): string {
  const def = GATHER[kind];
  if (def.tool && !gatesOpen() && itemCount(def.tool) <= 0) return `${def.label} needs a ${def.tool === "stoneAxe" ? "stone axe" : "stone pick"} in your stores`;
  if (packWeight(lifeOf(p)) + def.amount * PACK_WEIGHT[def.good] > PACK_CAP) return "Your pack is full: deposit it at a Town Center or chest, or sell it";
  return "";
}

function startGather(p: Player, tx: number, ty: number, kind: GatherKind) {
  const b = busyOf(p);
  const why = gatherBlock(p, kind);
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
function nearOwnStore(p: Player, tiles: number): boolean {
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
  toast(p, "You found a camp: two settlers join you");
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
  if (m < 3 && nearOwnStore(p, 2)) m = 3;
  // Modular building phase 2: resting in a bedroom (x its quality, shared/src/rooms.ts).
  m = Math.max(m, heroRestMultAt(p.x, p.y));
  // Stardew phase 5c: in your own house / hall interior (your bed).
  m = Math.max(m, interiorRestMult(p));
  return m;
}

// Stardew phase 5b: winter rest multipliers (gain while resting, decay otherwise); 1 / 1 outside winter.
function coldMult(p: Player): { gain: number; decay: number } {
  // Stardew phase 5c: indoors (any building interior) is out of the cold.
  if (!winterNow() || p.interior) return { gain: 1, decay: 1 };
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
  g.left -= skillSpeed(skillLevel(life, def.skill)) * energySpeed(life);
  if (g.left > 0) return;
  life.pack[def.good] = (life.pack[def.good] ?? 0) + def.amount;
  gainSkill(p, def.skill, def.seconds);
  spendEnergy(life, g.kind === "chop" ? ENERGY_COST.chop : g.kind === "mine" || g.kind === "quarry" ? ENERGY_COST.mine : 0);
  if (g.kind === "chop" && Math.random() < TREE_FELL_CHANCE) {
    setTile(i, TileType.Empty);
    broadcastTileUpdate(g.tx, g.ty, TileType.Empty);
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
  const why = gatherBlock(p, g.kind);
  if (why) {
    b.gather = undefined;
    toast(p, why);
    return;
  }
  g.left = g.total;
}

// The hero as a station's worker: the first ready recipe at the hero's skill level, inputs from the stores, output
// grade = min(station level, skill level), speed by that tier; 1 XP a second while a batch runs.
function stepWork(p: Player, b: Busy, w: WorkJob) {
  if (state.tiles[tileIndex(w.tx, w.ty)] !== w.tile || tileCenterDist(p, w.tx, w.ty) > 3) {
    b.work = undefined;
    return;
  }
  const life = lifeOf(p);
  const lv = skillLevel(life, w.skill);
  const tier = Math.min(lv, Math.max(1, getBuildingLevel(w.tx, w.ty)));
  if (!w.job) {
    const r = stationRecipes(w.tile).find((rc) => (rc.workerLevel ?? 1) <= lv && recipeReady(rc));
    if (!r) {
      const why = stationIdleReason(w.tile);
      if (w.idle !== why) toast(p, `Nothing to make: ${why}`);
      w.idle = why;
      return;
    }
    w.idle = undefined;
    if (!state.creative) for (const [k, n] of Object.entries(r.stock ?? {})) state.stock[k as keyof typeof state.stock] -= n ?? 0;
    for (const [id, n] of Object.entries(r.items ?? {}) as [ItemId, number][]) takeItem(id, n);
    const total = Math.max(1, Math.round((r.seconds ?? 30) * TICK_RATE));
    w.job = { recipe: r, left: total, total };
  }
  w.job.left -= skillSpeed(tier);
  if (state.cycleTick % TICK_RATE === 0) gainSkill(p, w.skill, 1);
  if (w.job.left <= 0) {
    addItem(w.job.recipe.output, w.job.recipe.amount, tier);
    toast(p, `You made ${w.job.recipe.amount} ${w.job.recipe.label.replace(/^\w+ (an? )?/, "")}`);
    w.job = undefined;
  }
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
    ...(b?.gather ? { gather: { label: GATHER[b.gather.kind].label, p: Math.round(100 * (1 - b.gather.left / b.gather.total)) / 100 } } : {}),
    ...(b?.tool ? { gather: { label: TOOL_ACT_LABEL[b.tool.act], p: Math.round(100 * (1 - b.tool.left / b.tool.total)) / 100 } } : {}),
    energy: Math.round(energyOf(life)),
    water: waterOf(life),
    ...(b?.work ? { work: { label: b.work.job ? b.work.job.recipe.label : `Idle: ${b.work.idle ?? "..."}`, p: b.work.job ? Math.round(100 * (1 - b.work.job.left / b.work.job.total)) / 100 : 0 } } : {}),
    ...(b?.resting ? { resting: true } : {}),
    ...(slow.length ? { slow } : {}),
    builds: life.builds.length,
    ...(clanTownCentersOf(p).length === 0 ? { canFound: true } : {}),
    ...(cachedFamilySnapshot(p) ? { family: cachedFamilySnapshot(p) } : {}),
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
