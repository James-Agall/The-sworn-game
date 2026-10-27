// Client-side sound (ROADMAP §7 Phase 7). Web Audio API, no dependencies.
//
// Assets come from /audio/manifest.json:
//   { "sfx": { "<key>": ["sfx/a.ogg", ...variants] }, "music": { "day": [...], "night": [...] } }
// (paths relative to /audio/). Everything is optional: a missing manifest, key or file (404, bad
// decode) just means that sound never plays. Nothing is logged and nothing throws.
//
// This module has no imports and touches no browser globals at load time, so its pure helpers
// (proximityGain, stereoPan, parseManifest, parseVolumeSettings) can be imported by a plain Node
// script (client/sound-test.mjs).

// ---- Tunables ----
// Positional falloff, in tiles from the local player: full volume inside FULL, silent past SILENT,
// a squared (inverse-ish) curve between.
export const SOUND_FULL_RADIUS_TILES = 2;
export const SOUND_SILENT_RADIUS_TILES = 14;
// Stereo pan: a source this many tiles to the side is panned SOUND_MAX_PAN (never fully one ear).
export const SOUND_PAN_WIDTH_TILES = 10;
export const SOUND_MAX_PAN = 0.6;
// Simultaneous one-shot voices (loops and music don't count). Extra one-shots are dropped.
export const MAX_SFX_VOICES = 12;
// Random playbackRate spread on one-shots: 1 +/- this.
export const DEFAULT_PITCH_VARIATION = 0.06;
export const MUSIC_CROSSFADE_SECONDS = 3;
// Below this a positional sound isn't worth a voice.
const MIN_AUDIBLE_GAIN = 0.02;
// Same-key re-trigger guard in ms (any key not listed uses DEFAULT_SFX_COOLDOWN_MS).
export const DEFAULT_SFX_COOLDOWN_MS = 60;
export const SFX_COOLDOWN_MS: Record<string, number> = {
  ui_click: 40,
  sword_hit: 70,
  sword_swing: 120,
  arrow_shoot: 90,
  arrow_hit: 90,
  tree_chop: 140,
  mine_pick: 140,
  farm_work: 220,
  craft_hammer: 200,
  heal_chime: 400,
  player_hurt: 350,
  monster_growl: 3500,
  monster_death: 120,
  colonist_death: 250,
  build_place: 80,
  build_upgrade: 300,
  horse_whinny: 8000,
  night_sting: 5000,
  dawn_chime: 5000,
  church_bell: 5000,
};
// Per-key base loudness (0-1) before the volume sliders. Unlisted keys play at 1.
export const SFX_BASE_VOLUME: Record<string, number> = {
  ui_click: 0.45,
  build_place: 0.7,
  build_upgrade: 0.8,
  tree_chop: 0.55,
  mine_pick: 0.5,
  farm_work: 0.45,
  craft_hammer: 0.5,
  heal_chime: 0.5,
  sword_hit: 0.6,
  sword_swing: 0.5,
  arrow_shoot: 0.5,
  arrow_hit: 0.45,
  player_hurt: 0.8,
  colonist_death: 0.8,
  monster_death: 0.65,
  monster_growl: 0.6,
  horse_gallop: 0.35,
  horse_whinny: 0.5,
  night_sting: 0.85,
  dawn_chime: 0.75,
  church_bell: 0.55,
  water_ambient: 0.35,
  fire_crackle: 0.35,
};

// ---- Pure helpers ----

export function proximityGain(
  dxPx: number,
  dyPx: number,
  tileSize: number,
  fullTiles = SOUND_FULL_RADIUS_TILES,
  silentTiles = SOUND_SILENT_RADIUS_TILES
): number {
  const d = Math.hypot(dxPx, dyPx) / tileSize;
  if (!Number.isFinite(d)) return 0;
  if (d <= fullTiles) return 1;
  if (d >= silentTiles) return 0;
  const t = 1 - (d - fullTiles) / (silentTiles - fullTiles);
  return t * t;
}

export function stereoPan(dxPx: number, tileSize: number): number {
  const p = dxPx / tileSize / SOUND_PAN_WIDTH_TILES;
  if (!Number.isFinite(p)) return 0;
  return Math.max(-1, Math.min(1, p)) * SOUND_MAX_PAN;
}

export interface SoundManifest {
  sfx: Record<string, string[]>;
  music: Record<string, string[]>;
}

export function emptyManifest(): SoundManifest {
  return { sfx: {}, music: {} };
}

// Relative paths only (no scheme, no leading slash, no "..").
function cleanPath(p: unknown): string | null {
  if (typeof p !== "string") return null;
  const s = p.trim().replace(/^\.\//, "");
  if (!s || s.includes("..") || /^[a-z]+:/i.test(s) || s.startsWith("/")) return null;
  return s;
}

function parseGroup(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const list = (Array.isArray(value) ? value : [value]).map(cleanPath).filter((p): p is string => p !== null);
    if (list.length > 0) out[key] = list;
  }
  return out;
}

// Never throws: anything malformed collapses to "no sounds".
export function parseManifest(raw: unknown): SoundManifest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyManifest();
  const r = raw as Record<string, unknown>;
  return { sfx: parseGroup(r.sfx), music: parseGroup(r.music) };
}

export interface VolumeSettings {
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
}

export const DEFAULT_VOLUMES: VolumeSettings = { master: 0.8, music: 0.5, sfx: 0.8, muted: false };
export const VOLUME_STORAGE_KEY = "sworn.sound";

const clamp01 = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;

export function parseVolumeSettings(raw: string | null): VolumeSettings {
  let obj: Record<string, unknown> = {};
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") obj = parsed;
  } catch {
    /* corrupt value: defaults */
  }
  return {
    master: clamp01(obj.master, DEFAULT_VOLUMES.master),
    music: clamp01(obj.music, DEFAULT_VOLUMES.music),
    sfx: clamp01(obj.sfx, DEFAULT_VOLUMES.sfx),
    muted: typeof obj.muted === "boolean" ? obj.muted : DEFAULT_VOLUMES.muted,
  };
}

// ---- Manager ----

export interface PlayOptions {
  // World pixel position; omit for a non-positional (UI / global) sound.
  x?: number;
  y?: number;
  volume?: number;
  pitchVariation?: number;
  // Overrides SFX_COOLDOWN_MS for this call.
  cooldownMs?: number;
  // Seconds from now.
  delay?: number;
  // Bypasses the voice cap (global stings).
  priority?: boolean;
}

interface LoopVoice {
  key: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

interface MusicVoice {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

type FetchLike = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> }>;

export class SoundManager {
  readonly baseUrl: string;
  tileSize = 32;
  volumes: VolumeSettings;
  private ctx: AudioContext | null = null;
  private masterBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private manifest: SoundManifest = emptyManifest();
  private manifestRequested = false;
  // url -> decoded buffer, or null when it failed (never retried).
  private buffers = new Map<string, AudioBuffer | null>();
  private pending = new Map<string, Promise<AudioBuffer | null>>();
  private voices = 0;
  private lastPlayed = new Map<string, number>();
  private listenerX = 0;
  private listenerY = 0;
  private hasListener = false;
  private loops = new Map<string, LoopVoice>();
  private musicMode: string | null = null;
  private musicVoice: MusicVoice | null = null;
  private fetchFn: FetchLike | null;
  private storage: Pick<Storage, "getItem" | "setItem"> | null;

  constructor(baseUrl = "/audio/") {
    this.baseUrl = baseUrl;
    this.fetchFn = typeof fetch === "function" ? (fetch.bind(globalThis) as unknown as FetchLike) : null;
    let storage: Pick<Storage, "getItem" | "setItem"> | null = null;
    try {
      storage = typeof localStorage !== "undefined" ? localStorage : null;
    } catch {
      storage = null;
    }
    this.storage = storage;
    let raw: string | null = null;
    try {
      raw = storage?.getItem(VOLUME_STORAGE_KEY) ?? null;
    } catch {
      raw = null;
    }
    this.volumes = parseVolumeSettings(raw);
  }

  get unlocked(): boolean {
    return this.ctx !== null;
  }

  // Call from a user gesture (the Start click, or any menu click): creates/resumes the
  // AudioContext and starts fetching the manifest. Safe to call repeatedly.
  unlock() {
    if (!this.ctx) {
      const g = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const Ctor = g.AudioContext ?? g.webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
      } catch {
        this.ctx = null;
        return;
      }
      const ctx = this.ctx;
      this.masterBus = ctx.createGain();
      this.musicBus = ctx.createGain();
      this.sfxBus = ctx.createGain();
      this.musicBus.connect(this.masterBus);
      this.sfxBus.connect(this.masterBus);
      this.masterBus.connect(ctx.destination);
      this.applyVolumes();
      if (typeof document !== "undefined") {
        // Tab hidden: suspend everything (music included); resume when it's back.
        document.addEventListener("visibilitychange", () => {
          if (!this.ctx) return;
          if (document.hidden) void this.ctx.suspend().catch(() => {});
          else void this.ctx.resume().catch(() => {});
        });
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
    void this.loadManifest();
  }

  async loadManifest(): Promise<SoundManifest> {
    if (this.manifestRequested) return this.manifest;
    this.manifestRequested = true;
    let raw: unknown = null;
    try {
      const res = this.fetchFn ? await this.fetchFn(`${this.baseUrl}manifest.json`) : null;
      if (res && res.ok) raw = await res.json();
    } catch {
      raw = null;
    }
    this.manifest = parseManifest(raw);
    // One-shots are short: decode them all up front so the first trigger isn't skipped.
    for (const list of Object.values(this.manifest.sfx)) for (const p of list) void this.load(p);
    return this.manifest;
  }

  has(key: string): boolean {
    return (this.manifest.sfx[key]?.length ?? 0) > 0;
  }

  // Keys whose files decoded (for diagnostics/tests); call after loadManifest settles.
  async resolvedKeys(): Promise<{ sfx: string[]; music: string[] }> {
    const ok = async (group: Record<string, string[]>) => {
      const keys: string[] = [];
      for (const [key, list] of Object.entries(group)) {
        const results = await Promise.all(list.map((p) => this.load(p)));
        if (results.some((b) => b !== null)) keys.push(key);
      }
      return keys;
    };
    return { sfx: await ok(this.manifest.sfx), music: await ok(this.manifest.music) };
  }

  private load(path: string): Promise<AudioBuffer | null> {
    if (this.buffers.has(path)) return Promise.resolve(this.buffers.get(path)!);
    const inflight = this.pending.get(path);
    if (inflight) return inflight;
    const ctx = this.ctx;
    const fetchFn = this.fetchFn;
    const p = (async () => {
      if (!ctx || !fetchFn) return null;
      try {
        const res = await fetchFn(this.baseUrl + path);
        if (!res.ok) return null;
        const data = await res.arrayBuffer();
        return await ctx.decodeAudioData(data);
      } catch {
        return null;
      }
    })().then((buf) => {
      // Without a context nothing was attempted: leave it uncached so a later unlock can load it.
      if (ctx) this.buffers.set(path, buf);
      this.pending.delete(path);
      return buf;
    });
    this.pending.set(path, p);
    return p;
  }

  // A decoded variant for this key, or null (not loaded yet / missing). Kicks off loading.
  private pickBuffer(group: Record<string, string[]>, key: string): AudioBuffer | null {
    const list = group[key];
    if (!list || list.length === 0) return null;
    const ready = list.map((p) => this.buffers.get(p)).filter((b): b is AudioBuffer => !!b);
    for (const p of list) if (!this.buffers.has(p)) void this.load(p);
    if (ready.length === 0) return null;
    return ready[Math.floor(Math.random() * ready.length)];
  }

  setListener(x: number, y: number) {
    this.listenerX = x;
    this.listenerY = y;
    this.hasListener = true;
  }

  // Positional gain for a world point (1 when there's no listener yet or no position given).
  gainAt(x?: number, y?: number): number {
    if (x === undefined || y === undefined || !this.hasListener) return 1;
    return proximityGain(x - this.listenerX, y - this.listenerY, this.tileSize);
  }

  play(key: string, opts: PlayOptions = {}) {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || this.volumes.muted || ctx.state !== "running") return;
    const positional = opts.x !== undefined && opts.y !== undefined && this.hasListener;
    const distanceGain = positional ? this.gainAt(opts.x, opts.y) : 1;
    if (distanceGain < MIN_AUDIBLE_GAIN) return;
    if (!opts.priority && this.voices >= MAX_SFX_VOICES) return;
    const now = performance.now();
    const cooldown = opts.cooldownMs ?? SFX_COOLDOWN_MS[key] ?? DEFAULT_SFX_COOLDOWN_MS;
    if (now - (this.lastPlayed.get(key) ?? -Infinity) < cooldown) return;
    const buffer = this.pickBuffer(this.manifest.sfx, key);
    if (!buffer) return;
    this.lastPlayed.set(key, now);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const spread = opts.pitchVariation ?? DEFAULT_PITCH_VARIATION;
    source.playbackRate.value = 1 + (Math.random() * 2 - 1) * spread;
    const gain = ctx.createGain();
    gain.gain.value = (opts.volume ?? 1) * (SFX_BASE_VOLUME[key] ?? 1) * distanceGain;
    let tail: AudioNode = gain;
    source.connect(gain);
    if (positional && typeof ctx.createStereoPanner === "function") {
      const pan = ctx.createStereoPanner();
      pan.pan.value = stereoPan(opts.x! - this.listenerX, this.tileSize);
      gain.connect(pan);
      tail = pan;
    }
    tail.connect(this.sfxBus);
    this.voices++;
    source.onended = () => {
      this.voices = Math.max(0, this.voices - 1);
      source.disconnect();
      tail.disconnect();
      if (tail !== gain) gain.disconnect();
    };
    try {
      source.start(ctx.currentTime + Math.max(0, opts.delay ?? 0));
    } catch {
      this.voices = Math.max(0, this.voices - 1);
    }
  }

  // Continuous sounds (horse gallop, ambience): call every update with the wanted level; a level
  // of 0 fades the loop out and frees it. `rate` is the playbackRate (gallop cadence).
  setLoop(id: string, key: string, level: number, rate = 1) {
    const ctx = this.ctx;
    const existing = this.loops.get(id);
    if (!ctx || !this.sfxBus || level <= 0.001 || this.volumes.muted) {
      if (existing) this.stopLoop(id, existing);
      return;
    }
    const target = level * (SFX_BASE_VOLUME[key] ?? 1);
    if (existing && existing.key === key) {
      existing.gain.gain.setTargetAtTime(target, ctx.currentTime, 0.12);
      existing.source.playbackRate.setTargetAtTime(rate, ctx.currentTime, 0.12);
      return;
    }
    if (existing) this.stopLoop(id, existing);
    const buffer = this.pickBuffer(this.manifest.sfx, key);
    if (!buffer) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(target, ctx.currentTime, 0.12);
    source.connect(gain).connect(this.sfxBus);
    // Random start offset so two loops of one sample don't phase.
    source.start(ctx.currentTime, Math.random() * buffer.duration);
    this.loops.set(id, { key, source, gain });
  }

  private stopLoop(id: string, voice: LoopVoice) {
    this.loops.delete(id);
    const ctx = this.ctx;
    if (!ctx) return;
    voice.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    try {
      voice.source.stop(ctx.currentTime + 0.5);
    } catch {
      /* already stopped */
    }
    voice.source.onended = () => {
      voice.source.disconnect();
      voice.gain.disconnect();
    };
  }

  // "day" / "night" (keys of manifest.music). Crossfades over MUSIC_CROSSFADE_SECONDS; a mode with
  // no track just fades the old one out. No-op until unlocked.
  setMusicMode(mode: string | null) {
    if (!this.ctx || mode === this.musicMode) return;
    this.musicMode = mode;
    void this.startMusic(mode);
  }

  private async startMusic(mode: string | null) {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    await this.loadManifest();
    const list = mode ? this.manifest.music[mode] : undefined;
    const path = list && list.length > 0 ? list[Math.floor(Math.random() * list.length)] : null;
    const buffer = path ? await this.load(path) : null;
    // A newer mode change won the race while this one was loading.
    if (this.musicMode !== mode) return;
    const now = ctx.currentTime;
    const old = this.musicVoice;
    this.musicVoice = null;
    if (old) {
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + MUSIC_CROSSFADE_SECONDS);
      try {
        old.source.stop(now + MUSIC_CROSSFADE_SECONDS + 0.1);
      } catch {
        /* already stopped */
      }
      old.source.onended = () => {
        old.source.disconnect();
        old.gain.disconnect();
      };
    }
    if (!buffer) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + MUSIC_CROSSFADE_SECONDS);
    source.connect(gain).connect(this.musicBus);
    source.start(now);
    this.musicVoice = { source, gain };
  }

  setVolumes(patch: Partial<VolumeSettings>) {
    this.volumes = { ...this.volumes, ...patch };
    try {
      this.storage?.setItem(VOLUME_STORAGE_KEY, JSON.stringify(this.volumes));
    } catch {
      /* private mode: won't persist */
    }
    this.applyVolumes();
    if (this.volumes.muted) for (const [id, loop] of Array.from(this.loops)) this.stopLoop(id, loop);
  }

  private applyVolumes() {
    const ctx = this.ctx;
    if (!ctx || !this.masterBus || !this.musicBus || !this.sfxBus) return;
    const v = this.volumes;
    const t = ctx.currentTime;
    this.masterBus.gain.setTargetAtTime(v.muted ? 0 : v.master, t, 0.03);
    this.musicBus.gain.setTargetAtTime(v.music, t, 0.03);
    this.sfxBus.gain.setTargetAtTime(v.sfx, t, 0.03);
  }
}
