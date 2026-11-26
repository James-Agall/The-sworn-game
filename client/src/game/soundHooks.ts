// Sound triggers driven by snapshots / events / tile updates (work loops, growls, horse, ambience, placement
// confirms) and the upgrade sparkle FX. Split out of main.ts (2026-11-26).
import type { ServerMessage, GameEventCategory } from "@colony/shared/protocol";
import { PLAYER_SPEED, TileType } from "@colony/shared/protocol";
import { SOUND_SILENT_RADIUS_TILES, proximityGain } from "../sound";
import { sound, WORK_SOUND_INTERVAL_MS, CRAFT_VOLUME_NON_SMITH, MOB_GROWL_RADIUS_TILES, MOB_GROWL_CHANCE, HORSE_MOVING_MIN_SPEED, HORSE_RATE_MIN, HORSE_RATE_MAX, HORSE_TELEPORT_SPEED, HORSE_WHINNY_IDLE_MS, HORSE_WHINNY_CHANCE, AMBIENT_SCAN_MS, AMBIENT_TILE_LOOPS, DAWN_BELL_DELAY_S, PLACEMENT_CONFIRM_MS, workSoundKey } from "../soundTriggers";

// Closure state from main.ts. Plain fields are fixed references (objects mutated in place, functions); the
// readonly / settable ones are live getters (or setters) onto main's `let` variables.
export interface SoundHooksContext {
  tileCenter: (tx: number, ty: number) => { x: number; y: number; };
  spawnFxAnim: (kind: "build" | "upgrade" | "heal" | "poison" | "wardPulse" | "wardLapse", x: number, y: number, durationMs: number, underIndex?: number) => void;
  soundSuppressed: boolean;
  readonly tileSize: number;
  readonly myId: string | null;
  readonly worldTilesY: number;
  readonly worldTilesX: number;
  readonly tiles: number[];
}

export function createSoundHooks(game: SoundHooksContext) {
  const { tileCenter, spawnFxAnim } = game;
  // ---- Sound triggers driven by snapshots ----
  // colonist id -> its current work sound and when it next plays.
  const workSoundTimers = new Map<string, { key: string; next: number }>();
  const growledMobs = new Set<string>();
  let lastMyHp: number | null = null;
  let lastMyPos: { x: number; y: number; at: number } | null = null;
  let horseIdleSince = performance.now();
  let horseMoving = false;
  let lastAmbientScan = 0;
  // tile index -> {tile, at}: setTile requests we sent, so their tileUpdate can sound as ours.
  const pendingPlacements = new Map<number, { tile: number; at: number }>();
  function resetSoundState() {
    game.soundSuppressed = true;
    workSoundTimers.clear();
    growledMobs.clear();
    lastMyHp = null;
    lastMyPos = null;
    pendingPlacements.clear();
  }
  function soundOnSnapshot(snap: Extract<ServerMessage, { type: "snapshot" }>) {
    sound.tileSize = game.tileSize;
    sound.setMusicMode(snap.isNight ? "night" : "day");
    const now = performance.now();
    const me = snap.players.find((p) => p.id === game.myId);
    if (me) {
      sound.setListener(me.x, me.y);
      if (lastMyHp !== null && me.hp < lastMyHp && !game.soundSuppressed) sound.play("player_hurt");
      lastMyHp = me.hp;

      let speed = 0;
      if (lastMyPos && now > lastMyPos.at) {
        speed = Math.hypot(me.x - lastMyPos.x, me.y - lastMyPos.y) / ((now - lastMyPos.at) / 1000);
        if (speed > HORSE_TELEPORT_SPEED) speed = 0;
      }
      // Snapshots can arrive bunched; only resample the speed every ~80 ms.
      if (!lastMyPos || now - lastMyPos.at >= 80) {
        lastMyPos = { x: me.x, y: me.y, at: now };
        const moving = speed > HORSE_MOVING_MIN_SPEED && !snap.isPaused;
        if (moving && !horseMoving && now - horseIdleSince > HORSE_WHINNY_IDLE_MS && Math.random() < HORSE_WHINNY_CHANCE) {
          sound.play("horse_whinny");
        }
        if (!moving && horseMoving) horseIdleSince = now;
        horseMoving = moving;
        const rate = Math.max(HORSE_RATE_MIN, Math.min(HORSE_RATE_MAX, speed / PLAYER_SPEED));
        sound.setLoop("horse", "horse_gallop", moving ? 1 : 0, rate);
      }

      if (now - lastAmbientScan >= AMBIENT_SCAN_MS) {
        lastAmbientScan = now;
        const r = SOUND_SILENT_RADIUS_TILES;
        const ptx = Math.floor(me.x / game.tileSize);
        const pty = Math.floor(me.y / game.tileSize);
        for (const loop of AMBIENT_TILE_LOOPS) {
          let best = Infinity;
          for (let ty = Math.max(0, pty - r); ty <= Math.min(game.worldTilesY - 1, pty + r); ty++) {
            for (let tx = Math.max(0, ptx - r); tx <= Math.min(game.worldTilesX - 1, ptx + r); tx++) {
              if (game.tiles[ty * game.worldTilesX + tx] !== loop.tile) continue;
              best = Math.min(best, Math.hypot(tx * game.tileSize + game.tileSize / 2 - me.x, ty * game.tileSize + game.tileSize / 2 - me.y));
            }
          }
          const level = best === Infinity ? 0 : proximityGain(best, 0, game.tileSize);
          sound.setLoop(loop.id, loop.key, level);
        }
      }
    }

    // Workers: one sound per work cycle each, phase-staggered so a whole village doesn't hit in sync.
    // Paused: the simulation is frozen, so nobody's working.
    const seen = new Set<string>();
    for (const c of snap.isPaused ? [] : snap.colonists) {
      seen.add(c.id);
      const key = workSoundKey(c);
      if (!key) {
        workSoundTimers.delete(c.id);
        continue;
      }
      const interval = WORK_SOUND_INTERVAL_MS[key] ?? 2000;
      const timer = workSoundTimers.get(c.id);
      if (!timer || timer.key !== key) {
        workSoundTimers.set(c.id, { key, next: now + Math.random() * interval * 0.5 });
        continue;
      }
      if (now < timer.next) continue;
      timer.next = now + interval;
      const volume =
        key === "craft_hammer" && game.tiles[c.postY * game.worldTilesX + c.postX] !== TileType.Blacksmith
          ? CRAFT_VOLUME_NON_SMITH
          : 1;
      sound.play(key, { x: c.x, y: c.y, volume });
    }
    for (const id of Array.from(workSoundTimers.keys())) if (!seen.has(id)) workSoundTimers.delete(id);

    // Mobs: maybe a growl the first time each comes within range (the per-key cooldown in sound.ts
    // keeps a whole wave from growling at once).
    const mobIds = new Set<string>();
    const growlRangePx = MOB_GROWL_RADIUS_TILES * game.tileSize;
    for (const m of snap.mobs) {
      mobIds.add(m.id);
      if (growledMobs.has(m.id) || !me) continue;
      if (Math.hypot(m.x - me.x, m.y - me.y) > growlRangePx) continue;
      growledMobs.add(m.id);
      if (!game.soundSuppressed && Math.random() < MOB_GROWL_CHANCE) sound.play("monster_growl", { x: m.x, y: m.y });
    }
    for (const id of Array.from(growledMobs)) if (!mobIds.has(id)) growledMobs.delete(id);
    game.soundSuppressed = false;
  }
  function soundOnEvent(category: GameEventCategory, text: string) {
    if (category === "night") sound.play("night_sting", { priority: true });
    // Phase 6: one of the player's regiments breaks (wavering / rally toasts stay silent).
    else if (category === "morale" && text.endsWith("routing!")) sound.play("night_sting", { priority: true });
    else if (category === "dawn") {
      sound.play("dawn_chime", { priority: true });
      sound.play("church_bell", { priority: true, delay: DAWN_BELL_DELAY_S });
    } else if (category === "upgrade" || category === "milestone") sound.play("build_upgrade", { priority: true });
  }
  function soundOnTileUpdate(tileX: number, tileY: number, tile: number) {
    const index = tileY * game.worldTilesX + tileX;
    const prev = game.tiles[index] ?? TileType.Empty;
    if (prev === TileType.ConstructionSite && tile !== TileType.Empty && tile !== TileType.ConstructionSite) {
      // A construction finished (anyone's): the build sparkle and the placement thud.
      pendingPlacements.delete(index);
      const c = tileCenter(tileX, tileY);
      spawnFxAnim("build", c.x, c.y + game.tileSize / 2, 700);
      sound.play("build_place", { x: c.x, y: c.y });
      return;
    }
    const pending = pendingPlacements.get(index);
    if (!pending) return;
    // Our placement became a construction site: the sound waits for its completion.
    if (tile === TileType.ConstructionSite) {
      pendingPlacements.delete(index);
      return;
    }
    pendingPlacements.delete(index);
    if (performance.now() - pending.at > PLACEMENT_CONFIRM_MS || tile === TileType.Empty) return;
    const c = tileCenter(tileX, tileY);
    // Our placement landed: on bare ground it's a build; on an existing building that turned into a
    // different tile (House -> Big House, barracks -> castle) it's an upgrade.
    spawnFxAnim(prev !== TileType.Empty && prev !== tile ? "upgrade" : "build", c.x, c.y + game.tileSize / 2, 700);
    if (pending.tile !== tile) return;
    sound.play("build_place", { x: c.x, y: c.y });
  }
  // In-place level-ups (huts, workshops, mines, ...) keep their tile, so no tileUpdate arrives; the
  // server's "upgrade" event confirms one instead. Play the upgrade effect at our most recent pending
  // placement of a building onto the same building.
  function fxOnUpgradeEvent() {
    let best: { index: number; at: number } | null = null;
    const now = performance.now();
    for (const [index, pending] of pendingPlacements) {
      if (now - pending.at > PLACEMENT_CONFIRM_MS || game.tiles[index] !== pending.tile) continue;
      if (!best || pending.at > best.at) best = { index, at: pending.at };
    }
    if (!best) return;
    pendingPlacements.delete(best.index);
    const c = tileCenter(best.index % game.worldTilesX, Math.floor(best.index / game.worldTilesX));
    spawnFxAnim("upgrade", c.x, c.y + game.tileSize / 2, 700);
  }
  return { resetSoundState, soundOnSnapshot, soundOnTileUpdate, fxOnUpgradeEvent, soundOnEvent, pendingPlacements };
}
