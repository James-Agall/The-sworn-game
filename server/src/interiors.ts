// interiors.ts: Stardew phase 5c (docs PLAN-rimworld-stardew.md 5c; ROADMAP "Stardew layer — phase 5c"). The hero
// enters a prefab building through its door (E on / walking north into it from the tile below it) and walks a small
// separate tile map built lazily from the building type's template (shared/src/interiors.ts). The world sim keeps
// running; the hero's world x / y stay at the door, where nothing can target or hurt it (mobs never enter). NPCs
// inside are bound to the building's real people (posted workers, residents) or, in a settlement, to its Elder /
// trader / priest / villagers, and talk through the existing dialogue (herolife.ts). Own buildings have a chest
// (pack <-> chest, saved per building) and, in a house or your hall, a bed (sleep to dawn / nap). Interiors are not
// part of the world grid: never saved, never streamed; only chest contents are saved (`interiorChests`).
import {
  INTERIOR_BARN_CHEST_CAP, INTERIOR_BED_REST_MULT, INTERIOR_BUMP_COOLDOWN_TICKS, INTERIOR_CHEST_CAP, INTERIOR_DOOR_REACH_TILES,
  INTERIOR_ENEMY_BLOCK_TILES, INTERIOR_ESC_EXIT_TILES, INTERIOR_FIXED_LEVEL, INTERIOR_REFRESH_TICKS, INTERIOR_SLEEP_TEMPLATES,
  INTERIOR_SPEED_MULT, INTERIOR_TEMPLATE_BY_TILE, INTERIOR_THREAT_ALERT_TILES, INTERIOR_USE_RANGE_TILES, buildInteriorMap,
  interiorSolidGrid, type InteriorMap, type InteriorNpcSnapshot, type InteriorTemplateId, type InteriorView,
} from "@colony/shared/interiors";
import { NPC_ROLE_LABEL, PACK_CAP, PACK_GOODS, PACK_LABEL, PACK_WEIGHT, TALK_RANGE_TILES, type NpcRole, type PackGood } from "@colony/shared/herolife";
import { PLAYER_HALF_SIZE, PLAYER_SPEED, TILE_SIZE, TileType } from "@colony/shared/protocol";
import type { Mob, Player, SiteState } from "./types.js";
import { GAME_DAY_TICKS, dt } from "./constants.js";
import { colonists, mobs, players, state } from "./state.js";
import { anchorOfTile, collidesAt, getBuildingLevel, inBounds, isNightNow, ownerAt, tileIndex } from "./tiles.js";
import { clanIdAt, clanOf, withClan } from "./clans.js";
import { siteByNum } from "./sites.js";
import { standingTown, tierOf } from "./diplomacy.js";
import { isTowerTarget } from "./combat.js";
import { isSleepingNeutral } from "./creative.js";
import { sendTo } from "./saves.js";
import { heroProfileOf } from "./heroes.js";
import { isMounted } from "./animals.js";
import {
  type ChoiceRt, type TalkInside, closeTalk, furnitureTalk, heroSpeedMult, lifeOf, nameFor, packWeight, restHeroFully,
  setHeroResting, startTalk, stopHeroBusy, talkColorFor, toast,
} from "./herolife.js";

// ---- chests (saved) ----
const chests = new Map<string, Partial<Record<PackGood, number>>>();

// ---- maps (generated lazily per template + level, never saved) ----
const maps = new Map<string, { map: InteriorMap; solid: Uint8Array }>();
function mapFor(id: InteriorTemplateId, level: number) {
  const k = `${id}:${level}`;
  let m = maps.get(k);
  if (!m) {
    const map = buildInteriorMap(id, level);
    maps.set(k, (m = { map, solid: interiorSolidGrid(map) }));
  }
  return m;
}

// The interior of the building anchored at (tx, ty), if it has one.
export function interiorTemplateAt(tx: number, ty: number): { id: InteriorTemplateId; tile: TileType; level: number } | null {
  if (!inBounds(tx, ty)) return null;
  const tile = state.tiles[tileIndex(tx, ty)] as TileType;
  const id = INTERIOR_TEMPLATE_BY_TILE[tile];
  if (!id) return null;
  const level = Math.max(1, Math.min(3, INTERIOR_FIXED_LEVEL[tile] ?? getBuildingLevel(tx, ty)));
  return { id, tile, level };
}

// Who may go in: your own clan's buildings, a friendly human settlement's buildings, the Abbey.
type Access = { kind: "own" } | { kind: "abbey" } | { kind: "site"; site: SiteState } | { refuse: string };
function accessFor(p: Player, tx: number, ty: number, tile: TileType): Access {
  if (tile === TileType.AbbeyHall) return { kind: "abbey" };
  const owner = ownerAt(tileIndex(tx, ty));
  if (owner !== 0) {
    const s = siteByNum(owner);
    if (!standingTown(s)) return { refuse: "Nobody lives there any more" };
    if (tierOf(p.clan ?? 0, s) === "hostile") return { refuse: `The door is barred to you (${s.name} is hostile)` };
    return { kind: "site", site: s };
  }
  if (tile === TileType.SiteKeep) return { refuse: "Nobody lives there any more" };
  if (clanIdAt(tx, ty) !== (p.clan ?? 0)) return { refuse: "That is not your building" };
  return { kind: "own" };
}

function isHostileMob(m: Mob): boolean {
  return m.hp > 0 && !m.siteWorker && isTowerTarget(m) && !isSleepingNeutral(m);
}
// Hostile mobs within `tiles` of the door tile (tx, ty + 1).
function hostilesNearDoor(tx: number, ty: number, tiles: number): number {
  const cx = (tx + 0.5) * TILE_SIZE;
  const cy = (ty + 1.5) * TILE_SIZE;
  const r = tiles * TILE_SIZE;
  let n = 0;
  for (const m of mobs.values()) {
    if (Math.abs(m.x - cx) > r || Math.abs(m.y - cy) > r || Math.hypot(m.x - cx, m.y - cy) > r) continue;
    if (isHostileMob(m)) n++;
  }
  return n;
}

// ---- NPC binding ----
interface Binding {
  snap: InteriorNpcSnapshot;
  role: NpcRole;
  name: string;
  colonistId?: string;
  site?: SiteState;
}
const px = (t: number) => (t + 0.5) * TILE_SIZE;

function bindNpcs(p: Player, key: string, tx: number, ty: number, map: InteriorMap, acc: Access): Binding[] {
  const out: Binding[] = [];
  const slots = (s: "1" | "2" | "v") => map.slots.filter((q) => q.slot === s);
  const put = (slot: { x: number; y: number }, b: Omit<Binding, "snap">, kind: string) => {
    out.push({
      ...b,
      snap: { id: `${key}:${out.length}`, name: b.name, roleLabel: NPC_ROLE_LABEL[b.role], x: slot.x, y: slot.y, color: talkColorFor(b.name), kind },
    });
  };
  if ("refuse" in acc) return out;
  if (acc.kind === "site") {
    const s = acc.site;
    const one = slots("1")[0];
    const id = map.templateId;
    if (one) {
      if (id === "hall") put(one, { role: "leader", name: `Elder ${nameFor(s.id)}`, site: s }, "villager");
      else if (id === "church") put(one, { role: "questGiver", name: `Brother ${nameFor(`${s.id}:priest`)}`, site: s }, "bishop");
      else put(one, { role: "trader", name: nameFor(`${s.id}:${key}:keeper`), site: s }, "villager");
    }
    const two = slots("2")[0];
    if (two) put(two, { role: "trader", name: nameFor(`${s.id}:trader`), site: s }, "villager");
    const vs = slots("v").slice(0, id === "tavern" ? 2 : id === "house" || id === "church" ? 1 : 0);
    vs.forEach((v, i) => put(v, { role: "villager", name: nameFor(`${s.id}:${key}:v${i}`), site: s }, "villager"));
    return out;
  }
  // Own buildings and the Abbey: the people posted here (keeper / priest), then those who live here.
  const clan = acc.kind === "abbey" ? 0 : p.clan ?? 0;
  const alive = Array.from(colonists.values()).filter((c) => c.hp > 0 && !c.ghost && (c.clan ?? 0) === clan && c.kind !== "wagon");
  const posted = alive.filter((c) => c.postX === tx && c.postY === ty).sort((a, b) => (a.id < b.id ? -1 : 1));
  const residents = alive
    .filter((c) => c.person && c.person.homeX === tx && c.person.homeY === ty && !posted.includes(c))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const roleOf = (c: (typeof alive)[number], isPosted: boolean): NpcRole =>
    c.kind === "bishop" || acc.kind === "abbey" ? "priest" : isPosted ? "keeper" : "folk";
  const queue = [...posted.map((c) => ({ c, posted: true })), ...residents.map((c) => ({ c, posted: false }))];
  for (const slot of [...slots("1"), ...slots("2"), ...slots("v")]) {
    const next = queue.shift();
    if (!next) break;
    const c = next.c;
    put(slot, { role: roleOf(c, next.posted), name: c.person?.name ?? nameFor(c.id), colonistId: c.id }, c.kind === "hero" ? "knight" : c.kind);
  }
  return out;
}

// ---- view ----
function titleFor(map: InteriorMap, acc: Access): string {
  if ("refuse" in acc) return map.label;
  if (acc.kind === "abbey") return "Saint Wren's Abbey";
  if (acc.kind === "site") return `${map.label}, ${acc.site.name}`;
  return `Your ${map.label.toLowerCase()}`;
}
const chestCapFor = (id: string) => (id === "barn" ? INTERIOR_BARN_CHEST_CAP : INTERIOR_CHEST_CAP);
const hasProp = (map: InteriorMap, prop: string) => map.props.some((q) => q.prop === prop);

function viewFor(p: Player): { view: InteriorView; npcs: Binding[]; acc: Access } | null {
  const I = p.interior;
  if (!I) return null;
  const { map } = mapFor(I.templateId as InteriorTemplateId, I.level);
  const acc = accessFor(p, I.tx, I.ty, I.tile as TileType);
  const npcs = bindNpcs(p, I.key, I.tx, I.ty, map, acc);
  const own = "kind" in acc && acc.kind === "own";
  const view: InteriorView = {
    key: I.key,
    tx: I.tx,
    ty: I.ty,
    map,
    npcs: npcs.map((b) => b.snap),
    chest: own && hasProp(map, "chest") ? { ...(chests.get(I.key) ?? {}) } : null,
    chestCap: chestCapFor(map.templateId),
    canSleep: own && INTERIOR_SLEEP_TEMPLATES.has(map.templateId) && (hasProp(map, "bed") || hasProp(map, "bedFine")),
    threat: hostilesNearDoor(I.tx, I.ty, INTERIOR_THREAT_ALERT_TILES),
    title: titleFor(map, acc),
  };
  return { view, npcs, acc };
}

function sendView(p: Player, force = false) {
  const v = viewFor(p);
  if (!v || !p.interior) return;
  const json = JSON.stringify(v.view);
  if (!force && json === p.interior.sent) return;
  p.interior.sent = json;
  sendTo(p, { type: "interior", view: v.view });
}

// ---- enter / exit ----
// The building whose door the hero stands at (door = the tile below a 1x1 prefab building). `bump`: only the
// hero's own tile counts (walking north into the building from its door tile).
function doorAt(p: Player, bump: boolean): { tx: number; ty: number } | null {
  const mx = Math.floor(p.x / TILE_SIZE);
  const my = Math.floor(p.y / TILE_SIZE);
  let best: { tx: number; ty: number; d: number } | null = null;
  const r = bump ? 0 : 1;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const doorX = mx + dx;
      const doorY = my + dy;
      if (!inBounds(doorX, doorY - 1)) continue;
      const a = anchorOfTile(doorX, doorY - 1);
      if (a.x !== doorX || a.y !== doorY - 1 || !interiorTemplateAt(a.x, a.y)) continue;
      const d = Math.hypot(px(doorX) - p.x, px(doorY) - p.y) / TILE_SIZE;
      if (d <= INTERIOR_DOOR_REACH_TILES && (!best || d < best.d)) best = { tx: a.x, ty: a.y, d };
    }
  }
  return best;
}

// E / a bump at a door: true when there was a door (entered, or refused with a toast).
export function tryEnterAtDoor(p: Player, bump: boolean): boolean {
  if (p.dead || p.interior) return false;
  const door = doorAt(p, bump);
  if (!door) return false;
  if (bump) {
    if (state.cycleTick - (p.interiorBumpTick ?? -1e9) < INTERIOR_BUMP_COOLDOWN_TICKS) return true;
    p.interiorBumpTick = state.cycleTick;
  }
  const why = enterInterior(p, door.tx, door.ty);
  if (why) toast(p, why);
  return true;
}

// Puts the hero inside the building anchored at (tx, ty); "" = entered, else why not.
export function enterInterior(p: Player, tx: number, ty: number): string {
  if (p.dead) return "You cannot";
  // Gap closure G6: horses stay outside.
  if (isMounted(p)) return "Dismount first (X): horses stay outside";
  const t = interiorTemplateAt(tx, ty);
  if (!t) return "That building has no way in";
  const acc = accessFor(p, tx, ty, t.tile);
  if ("refuse" in acc) return acc.refuse;
  const near = hostilesNearDoor(tx, ty, INTERIOR_ENEMY_BLOCK_TILES);
  if (near > 0) return `Enemies are too close (${near} within ${INTERIOR_ENEMY_BLOCK_TILES} tiles): you cannot get inside`;
  stopHeroBusy(p);
  const { map } = mapFor(t.id, t.level);
  // The world body waits at the door.
  p.x = px(tx);
  p.y = px(ty + 1);
  p.interior = {
    key: `${tx},${ty}`, tx, ty, tile: t.tile, level: t.level, templateId: t.id,
    x: px(map.spawn.x), y: px(map.spawn.y), sent: "", nextRefresh: state.cycleTick + INTERIOR_REFRESH_TICKS,
  };
  sendView(p, true);
  return "";
}

// Back to the world at the building's door (the nearest free spot if something stands on it now).
export function exitInterior(p: Player, why = "") {
  const I = p.interior;
  if (!I) return;
  stopHeroBusy(p);
  p.interior = undefined;
  p.interiorBumpTick = state.cycleTick;
  let x = px(I.tx);
  let y = px(I.ty + 1);
  if (collidesAt(x, y)) {
    found: for (let r = 1; r <= 4; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = px(I.tx + dx);
          const ny = px(I.ty + 1 + dy);
          if (inBounds(I.tx + dx, I.ty + 1 + dy) && !collidesAt(nx, ny)) {
            x = nx;
            y = ny;
            break found;
          }
        }
      }
    }
  }
  p.x = x;
  p.y = y;
  sendTo(p, { type: "interior", view: null });
  if (why) toast(p, why);
}

// Esc near the exit mat.
export function handleInteriorExit(p: Player) {
  const I = p.interior;
  if (!I) return;
  const { map } = mapFor(I.templateId as InteriorTemplateId, I.level);
  if (Math.hypot(px(map.exit.x) - I.x, px(map.exit.y) - I.y) / TILE_SIZE > INTERIOR_ESC_EXIT_TILES) return toast(p, "Walk to the door mat to leave");
  exitInterior(p);
}

// ---- per tick ----
// sim.ts: the hero walks the interior map (its own small collision grid); stepping onto the exit mat leaves.
export function stepInteriorMovement(p: Player) {
  const I = p.interior;
  if (!I) return;
  const { map, solid } = mapFor(I.templateId as InteriorTemplateId, I.level);
  const { dx, dy } = p.input;
  const len = Math.hypot(dx, dy) || 1;
  const speed = PLAYER_SPEED * INTERIOR_SPEED_MULT * heroProfileOf(p).stats.moveSpeedMult * heroSpeedMult(p);
  const blocked = (x: number, y: number) => {
    for (const ox of [-PLAYER_HALF_SIZE, PLAYER_HALF_SIZE]) {
      for (const oy of [-PLAYER_HALF_SIZE, PLAYER_HALF_SIZE]) {
        const cx = Math.floor((x + ox) / TILE_SIZE);
        const cy = Math.floor((y + oy) / TILE_SIZE);
        if (cx < 0 || cy < 0 || cx >= map.w || cy >= map.h || solid[cy * map.w + cx]) return true;
      }
    }
    return false;
  };
  const nx = I.x + (dx / len) * speed * dt;
  if (!blocked(nx, I.y)) I.x = nx;
  const ny = I.y + (dy / len) * speed * dt;
  if (!blocked(I.x, ny)) I.y = ny;
  if (Math.floor(I.x / TILE_SIZE) === map.exit.x && Math.floor(I.y / TILE_SIZE) === map.exit.y) exitInterior(p);
}

// sim.ts, once a tick: dead heroes are put out; every INTERIOR_REFRESH_TICKS the building is re-checked (gone: out;
// upgraded: the new level's room) and the view is resent if its NPCs / chest / threat changed.
export function updateInteriors() {
  for (const p of players.values()) {
    const I = p.interior;
    if (!I) continue;
    if (p.dead) {
      exitInterior(p);
      continue;
    }
    if (state.cycleTick < I.nextRefresh) continue;
    I.nextRefresh = state.cycleTick + INTERIOR_REFRESH_TICKS;
    withClan(clanOf(p), () => {
      const t = interiorTemplateAt(I.tx, I.ty);
      if (!t || t.id !== I.templateId) return exitInterior(p, "The building is gone: you are back outside");
      if ("refuse" in accessFor(p, I.tx, I.ty, t.tile)) return exitInterior(p, "You are shown the door");
      if (t.level !== I.level || t.tile !== I.tile) {
        I.level = t.level;
        I.tile = t.tile;
        const { map, solid } = mapFor(t.id, t.level);
        const cx = Math.floor(I.x / TILE_SIZE);
        const cy = Math.floor(I.y / TILE_SIZE);
        if (cx < 0 || cy < 0 || cx >= map.w || cy >= map.h || solid[cy * map.w + cx]) Object.assign(I, { x: px(map.spawn.x), y: px(map.spawn.y) });
      }
      sendView(p);
    });
  }
}

// ---- E inside ----
export function interiorInteract(p: Player) {
  const I = p.interior;
  const v = viewFor(p);
  if (!I || !v) return;
  const { map } = v.view;
  const dist = (x: number, y: number) => Math.hypot(px(x) - I.x, px(y) - I.y) / TILE_SIZE;
  const inside = (x: number, y: number): TalkInside => ({ key: I.key, x: px(x), y: px(y), anchor: { x: I.tx, y: I.ty } });
  type Pick = { d: number; run: () => void };
  let best: Pick | null = null;
  const offer = (d: number, run: () => void) => {
    if (!best || d < best.d) best = { d, run };
  };
  for (const b of v.npcs) {
    const d = dist(b.snap.x, b.snap.y);
    if (d > TALK_RANGE_TILES) continue;
    const c = b.colonistId ? colonists.get(b.colonistId) : undefined;
    offer(d, () => startTalk(p, { role: b.role, name: b.name, d, site: b.site, colonist: c, inside: inside(b.snap.x, b.snap.y) }));
  }
  for (const q of map.props) {
    const d = dist(q.x, q.y);
    if (d > INTERIOR_USE_RANGE_TILES) continue;
    if (q.prop === "bed" || q.prop === "bedFine") offer(d, () => bedTalk(p, v.view.canSleep, v.view.threat, inside(q.x, q.y)));
    else if (q.prop === "chest") offer(d, () => (v.view.chest ? chestTalk(p, "", inside(q.x, q.y)) : toast(p, "This chest is not yours")));
  }
  const de = dist(map.exit.x, map.exit.y);
  if (de <= INTERIOR_USE_RANGE_TILES) offer(de + 0.25, () => exitInterior(p));
  const pick = best as Pick | null;
  if (pick) pick.run();
  else toast(p, "Nothing to use here (walk up to someone, a bed, a chest or the door mat)");
}

// Stardew phase 5c: interior rest multiplier for herolife.ts shelterMult (your own house / hall: your bed).
export function interiorRestMult(p: Player): number {
  const I = p.interior;
  if (!I || !INTERIOR_SLEEP_TEMPLATES.has(I.templateId as InteriorTemplateId)) return 1;
  const acc = accessFor(p, I.tx, I.ty, I.tile as TileType);
  return "kind" in acc && acc.kind === "own" ? INTERIOR_BED_REST_MULT : 1;
}

// ---- the bed ----
function bedTalk(p: Player, canSleep: boolean, threat: number, at: TalkInside, head = "") {
  if (!canSleep) return toast(p, "This is not your bed");
  const night = isNightNow();
  const choices: ChoiceRt[] = [
    { label: "Sleep until dawn.", action: "sleep", disabled: !night ? "It is still day: you can only nap" : threat > 0 ? "Not with enemies at the door" : undefined },
    { label: "Lie down for a while (rest faster; move to get up).", action: "nap" },
  ];
  furnitureTalk(p, "Your bed", (head ? head + "\n\n" : "") + "A warm bed in your own house.", choices, at);
}

// A full night's sleep: rest and energy full; time skips to dawn only when no other hero is connected.
function sleepToDawn(p: Player): string {
  restHeroFully(p);
  const others = Array.from(players.values()).filter((o) => o !== p && !o.dead);
  if (others.length > 0) return "You sleep a few hours and wake rested (others are awake: the night goes on).";
  // The tick before dawn: the next sim step is dawn (state.wasNight is already true), so dawn runs as ever.
  const day = Math.floor(state.cycleTick / GAME_DAY_TICKS);
  state.cycleTick = Math.max(state.cycleTick, (day + 1) * GAME_DAY_TICKS - 1);
  return "You sleep until dawn and wake rested.";
}

// ---- the chest ----
const chestWeight = (c: Partial<Record<PackGood, number>>) => Math.round(PACK_GOODS.reduce((w, g) => w + (c[g] ?? 0) * PACK_WEIGHT[g], 0) * 10) / 10;
const goodsText = (c: Partial<Record<PackGood, number>>) =>
  PACK_GOODS.filter((g) => (c[g] ?? 0) > 0).map((g) => `${c[g]} ${PACK_LABEL[g].toLowerCase()}`).join(", ") || "empty";

function chestTalk(p: Player, head: string, at: TalkInside) {
  const I = p.interior;
  if (!I) return;
  const chest = chests.get(I.key) ?? {};
  const life = lifeOf(p);
  const cap = chestCapFor(I.templateId);
  const cw = chestWeight(chest);
  const pw = packWeight(life);
  const choices: ChoiceRt[] = [
    { label: "Store everything you carry.", action: "chestPut", arg: "all", disabled: pw <= 0 ? "Your pack is empty" : cw >= cap ? "The chest is full" : undefined },
    { label: "Take everything.", action: "chestTake", arg: "all", disabled: cw <= 0 ? "The chest is empty" : pw >= PACK_CAP ? "Your pack is full" : undefined },
  ];
  for (const g of PACK_GOODS) if ((life.pack[g] ?? 0) > 0 && choices.length < 6) choices.push({ label: `Store your ${PACK_LABEL[g].toLowerCase()} (${life.pack[g]}).`, action: "chestPut", arg: g, disabled: cw >= cap ? "The chest is full" : undefined });
  for (const g of PACK_GOODS) if ((chest[g] ?? 0) > 0 && choices.length < 9) choices.push({ label: `Take the ${PACK_LABEL[g].toLowerCase()} (${chest[g]}).`, action: "chestTake", arg: g, disabled: pw >= PACK_CAP ? "Your pack is full" : undefined });
  const text = `${head ? head + "\n\n" : ""}Chest (${cw} / ${cap}): ${goodsText(chest)}.\nYour pack (${pw} / ${PACK_CAP}): ${goodsText(life.pack)}.`;
  furnitureTalk(p, "Chest", text, choices, at);
}

// Moves goods (all of `g`, or everything) from `from` into `to` while `to` stays under `cap` (weight). Returns the count.
function move(from: Partial<Record<PackGood, number>>, to: Partial<Record<PackGood, number>>, g: PackGood | "all", cap: number): number {
  let n = 0;
  let room = cap - chestWeight(to);
  for (const k of g === "all" ? PACK_GOODS : [g]) {
    const have = from[k] ?? 0;
    const q = Math.min(have, Math.floor((room + 1e-9) / PACK_WEIGHT[k]));
    if (q <= 0) continue;
    from[k] = have - q;
    if (!from[k]) delete from[k];
    to[k] = (to[k] ?? 0) + q;
    room -= q * PACK_WEIGHT[k];
    n += q;
  }
  return n;
}

// herolife.ts handleDialogueChoice: a bed / chest choice.
export function interiorFurnitureChoice(p: Player, action: string, arg: unknown) {
  const I = p.interior;
  const v = viewFor(p);
  if (!I || !v) return closeTalk(p);
  const { map } = v.view;
  const near = (prop: string) => map.props.find((q) => (q.prop === prop || (prop === "bed" && q.prop === "bedFine")) && Math.hypot(px(q.x) - I.x, px(q.y) - I.y) / TILE_SIZE <= TALK_RANGE_TILES + 2);
  const at = (q: { x: number; y: number }): TalkInside => ({ key: I.key, x: px(q.x), y: px(q.y), anchor: { x: I.tx, y: I.ty } });
  if (action === "sleep" || action === "nap") {
    const bed = near("bed");
    if (!bed || !v.view.canSleep) return closeTalk(p);
    if (action === "nap") {
      closeTalk(p);
      setHeroResting(p, true);
      return toast(p, "You lie down in your bed (move to get up)");
    }
    if (!isNightNow() || v.view.threat > 0) return bedTalk(p, v.view.canSleep, v.view.threat, at(bed));
    closeTalk(p);
    return toast(p, sleepToDawn(p));
  }
  const chestProp = near("chest");
  if (!chestProp || !v.view.chest) return closeTalk(p);
  const g = arg === "all" || (PACK_GOODS as unknown[]).includes(arg) ? (arg as PackGood | "all") : "all";
  const chest = chests.get(I.key) ?? {};
  const life = lifeOf(p);
  let head: string;
  if (action === "chestPut") {
    const n = move(life.pack, chest, g, chestCapFor(I.templateId));
    head = n > 0 ? `You store ${n} goods.` : "Nothing fits.";
  } else {
    // Pack capacity is weight too: fill the pack up to PACK_CAP.
    const n = move(chest, life.pack, g, PACK_CAP);
    head = n > 0 ? `You take ${n} goods.` : "Nothing fits in your pack.";
  }
  if (Object.keys(chest).length > 0) chests.set(I.key, chest);
  else chests.delete(I.key);
  chestTalk(p, head, at(chestProp));
  sendView(p);
}

// ---- snapshot / saves / tests ----
export function playerInside(p: Player): { key: string; x: number; y: number } | undefined {
  const I = p.interior;
  return I ? { key: I.key, x: Math.round(I.x * 10) / 10, y: Math.round(I.y * 10) / 10 } : undefined;
}

export type InteriorChestsSave = [string, Partial<Record<PackGood, number>>][];
export function interiorChestsForSave(): InteriorChestsSave | undefined {
  const out: InteriorChestsSave = [];
  for (const [k, c] of chests) if (Object.keys(c).length > 0) out.push([k, { ...c }]);
  return out.length ? out : undefined;
}
export function restoreInteriorChests(data: unknown) {
  chests.clear();
  if (!Array.isArray(data)) return;
  for (const e of data) {
    if (!Array.isArray(e) || typeof e[0] !== "string" || !e[1] || typeof e[1] !== "object") continue;
    const c: Partial<Record<PackGood, number>> = {};
    for (const g of PACK_GOODS) {
      const n = Math.floor(Number((e[1] as Record<string, unknown>)[g]));
      if (Number.isFinite(n) && n > 0) c[g] = n;
    }
    if (Object.keys(c).length) chests.set(e[0], c);
  }
}
export function resetInteriors() {
  chests.clear();
}

export function interiorDebug(p: Player) {
  const v = viewFor(p);
  const I = p.interior;
  return {
    inside: I ? { key: I.key, x: I.x, y: I.y, templateId: I.templateId, level: I.level } : null,
    view: v?.view ?? null,
    chests: Array.from(chests.entries()),
  };
}
