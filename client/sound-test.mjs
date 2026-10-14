// Headless sanity check for client/src/sound.ts (no browser, no audio output):
//   - proximity falloff and stereo pan maths
//   - manifest parsing is tolerant (missing / malformed / unsafe paths)
//   - volume settings parsing (corrupt / out-of-range values)
//   - SoundManager with no AudioContext and a 404 / throwing / valid manifest never throws
//   - if client/public/audio/manifest.json exists: every file it references exists on disk
// Run from the repo root:  node client/sound-test.mjs   (Node >= 22.18 strips the .ts types)
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  proximityGain,
  stereoPan,
  parseManifest,
  parseVolumeSettings,
  DEFAULT_VOLUMES,
  SoundManager,
  SOUND_FULL_RADIUS_TILES,
  SOUND_SILENT_RADIUS_TILES,
  SOUND_MAX_PAN,
} from "./src/sound.ts";

let fails = 0;
const check = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const T = 32;

// ---- falloff ----
check(proximityGain(0, 0, T) === 1, "gain 1 at the listener");
check(proximityGain(SOUND_FULL_RADIUS_TILES * T, 0, T) === 1, `gain 1 at ${SOUND_FULL_RADIUS_TILES} tiles`);
check(proximityGain(SOUND_SILENT_RADIUS_TILES * T, 0, T) === 0, `gain 0 at ${SOUND_SILENT_RADIUS_TILES} tiles`);
check(proximityGain(40 * T, 0, T) === 0, "gain 0 far away");
check(near(proximityGain(8 * T, 0, T), 0.25), `gain 0.25 at 8 tiles (got ${proximityGain(8 * T, 0, T)})`);
check(near(proximityGain(0, 8 * T, T), proximityGain(8 * T, 0, T)), "falloff is radial");
let mono = true;
for (let d = 0; d < 16 * T; d += 4) if (proximityGain(d + 4, 0, T) > proximityGain(d, 0, T)) mono = false;
check(mono, "falloff is monotonic non-increasing");
check(proximityGain(NaN, 0, T) === 0, "NaN distance -> silent, no throw");

// ---- pan ----
check(stereoPan(0, T) === 0, "pan 0 straight ahead");
check(stereoPan(5 * T, T) > 0 && stereoPan(-5 * T, T) < 0, "pan sign follows dx");
check(near(stereoPan(1000 * T, T), SOUND_MAX_PAN) && near(stereoPan(-1000 * T, T), -SOUND_MAX_PAN), "pan clamped to +/-SOUND_MAX_PAN");

// ---- manifest parsing ----
const empty = (m) => Object.keys(m.sfx).length === 0 && Object.keys(m.music).length === 0;
check(empty(parseManifest(null)), "null manifest -> empty");
check(empty(parseManifest("nope")), "string manifest -> empty");
check(empty(parseManifest([1, 2])), "array manifest -> empty");
check(empty(parseManifest({ sfx: 5, music: "x" })), "wrong-typed groups -> empty");
const m = parseManifest({
  sfx: {
    tree_chop: ["sfx/chop1.ogg", "sfx/chop2.ogg", 7, null],
    ui_click: "sfx/click.ogg",
    bad: ["../secret.ogg", "http://evil/x.ogg", "/abs.ogg"],
    none: [],
  },
  music: { day: ["music/day.ogg"], night: [] },
});
check(m.sfx.tree_chop.length === 2, "non-string variants dropped");
check(m.sfx.ui_click?.[0] === "sfx/click.ogg", "single string accepted as one variant");
check(!("bad" in m.sfx), "unsafe paths ('..', scheme, absolute) dropped");
check(!("none" in m.sfx) && !("night" in m.music), "empty variant lists dropped");
check(m.music.day[0] === "music/day.ogg", "music group parsed");

// ---- volume settings ----
const d = parseVolumeSettings(null);
check(JSON.stringify(d) === JSON.stringify(DEFAULT_VOLUMES), "missing volumes -> defaults");
check(JSON.stringify(parseVolumeSettings("{not json")) === JSON.stringify(DEFAULT_VOLUMES), "corrupt volumes -> defaults");
const v = parseVolumeSettings(JSON.stringify({ master: 3, music: -1, sfx: 0.4, muted: "yes" }));
check(v.master === 1 && v.music === 0 && v.sfx === 0.4 && v.muted === false, "volumes clamped, bad mute ignored");

// ---- manager without audio / with missing manifest ----
const realFetch = globalThis.fetch;
async function managerWith(fetchImpl) {
  globalThis.fetch = fetchImpl;
  const sm = new SoundManager();
  globalThis.fetch = realFetch;
  return sm;
}
let threw = false;
try {
  const sm = await managerWith(async () => ({ ok: false, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }));
  sm.unlock(); // no AudioContext in Node: stays locked
  check(!sm.unlocked, "no AudioContext -> stays locked, no throw");
  const man = await sm.loadManifest();
  check(empty(man), "404 manifest -> empty manifest");
  sm.setListener(10, 10);
  sm.play("tree_chop", { x: 0, y: 0 });
  sm.play("does_not_exist");
  sm.setLoop("horse", "horse_gallop", 1, 1);
  sm.setLoop("horse", "horse_gallop", 0);
  sm.setMusicMode("night");
  sm.setVolumes({ master: 0.3, muted: true });
  check(sm.volumes.master === 0.3 && sm.volumes.muted, "setVolumes works without localStorage/AudioContext");

  const sm2 = await managerWith(async () => {
    throw new Error("offline");
  });
  check(empty(await sm2.loadManifest()), "fetch throwing -> empty manifest");

  const sm3 = await managerWith(async () => ({ ok: true, json: async () => { throw new SyntaxError("html"); }, arrayBuffer: async () => new ArrayBuffer(0) }));
  check(empty(await sm3.loadManifest()), "non-JSON manifest (e.g. an HTML fallback) -> empty");

  const sm4 = await managerWith(async () => ({
    ok: true,
    json: async () => ({ sfx: { ui_click: ["sfx/click.ogg"] }, music: {} }),
    arrayBuffer: async () => new ArrayBuffer(0),
  }));
  await sm4.loadManifest();
  check(sm4.has("ui_click") && !sm4.has("tree_chop"), "valid manifest -> has() reflects keys");
  sm4.play("ui_click");
} catch (e) {
  threw = true;
  console.log(e);
}
check(!threw, "nothing threw");

// ---- on-disk manifest (if the audio has landed) ----
const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(here, "public/audio/manifest.json");
if (existsSync(manifestPath)) {
  let raw = null;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    check(false, `manifest.json is valid JSON (${e.message})`);
  }
  if (raw) {
    const parsed = parseManifest(raw);
    const missing = [];
    let files = 0;
    for (const group of [parsed.sfx, parsed.music]) {
      for (const list of Object.values(group)) {
        for (const p of list) {
          files++;
          const f = join(here, "public/audio", p);
          if (!existsSync(f) || statSync(f).size === 0) missing.push(p);
        }
      }
    }
    console.log(`INFO manifest: sfx keys [${Object.keys(parsed.sfx).join(", ")}]; music keys [${Object.keys(parsed.music).join(", ")}]; ${files} files`);
    check(missing.length === 0, `every manifest file exists and is non-empty${missing.length ? ": missing " + missing.join(", ") : ""}`);
  }
} else {
  console.log("INFO client/public/audio/manifest.json not present (game runs silent; that's handled)");
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`);
process.exit(fails === 0 ? 0 : 1);
