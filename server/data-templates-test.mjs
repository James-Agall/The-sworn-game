// Stage B data migration (STAGE-B-DATA-2026-11-26.md): the site templates, the POI pools, the Castle Ruin and the
// building interiors moved from TypeScript into JSON data files. This proves the move changed nothing:
//  1. data-templates-probe.mts (DATA_PROBE=world), ONE world per fresh process, for 6 seeds at sizes 160, 512 and 1024
//     at the current worldgen version 23 (the region world), size 96 at 23 (the small-map path: ruins, camps, Castle
//     Ruin) and sizes 160 / 512 at version 11 (the old path with generateForts and the stamped human sites): every hash
//     (tiles, biomes, owners, sites, hearths, mobs, region plan, landmarks, the whole save state) and the seeded draw
//     count must equal data-templates-golden.json.
//  2. DATA_PROBE=content: the deep contents of every moved table and the hash of buildInteriorMap / validation for
//     every interior template x variant x level x storey must equal the golden ones.
//  3. data-templates-loaders.mts: the loaders / validators (round trip, bad fixtures, user folders, old stores).
// The golden file was written ONCE from the unmodified base code (main-split c0d1c72) with
// `DATA_GOLDEN_WRITE=1 node server/data-templates-test.mjs`; never regenerate it on migrated code.
// Generation only: no game server is booted. `npm test -- data-templates`.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = import.meta.dirname;
const GOLDEN = path.join(dir, "data-templates-golden.json");
const SEEDS = [1, 7, 13, 42, 99, 2024];
const WORLDS = [
  ...[160, 512, 1024].flatMap((size) => SEEDS.map((seed) => ({ size, seed, version: 23 }))),
  ...SEEDS.map((seed) => ({ size: 96, seed, version: 23 })),
  ...[160, 512].flatMap((size) => SEEDS.map((seed) => ({ size, seed, version: 11 }))),
];

const probe = (env, tag, script = "data-templates-probe.mts") => new Promise((resolve, reject) => {
  const saveDir = mkdtempSync(path.join(os.tmpdir(), "colony-data-templates-"));
  const proc = spawn(process.execPath, ["--import", "tsx", script], {
    cwd: dir, stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, COLONY_TEST_HOOKS: "1", COLONY_SAVE_DIR: saveDir, ...env },
  });
  let out = "";
  proc.stdout.on("data", (d) => (out += d));
  proc.on("close", (code) => {
    rmSync(saveDir, { recursive: true, force: true });
    const line = out.split("\n").find((l) => l.startsWith(tag + " "));
    if (code !== 0 || !line) {
      process.stdout.write(out);
      reject(new Error(`${script} ${JSON.stringify(env)} exited ${code}`));
    } else resolve({ value: JSON.parse(line.slice(tag.length + 1)), out });
  });
});

// A few worlds at once (each its own process).
async function allWorlds() {
  const out = new Array(WORLDS.length);
  let next = 0;
  const lane = async () => {
    while (next < WORLDS.length) {
      const k = next++;
      const w = WORLDS[k];
      out[k] = (await probe({ DATA_PROBE: "world", COLONY_WORLD_SIZE: String(w.size), DATA_SEED: String(w.seed), DATA_VERSION: String(w.version) }, "DATAHASH")).value;
    }
  };
  await Promise.all([lane(), lane(), lane(), lane()]);
  return out;
}

const content = (await probe({ DATA_PROBE: "content" }, "DATACONTENT")).value;
const worlds = await allWorlds();

if (process.env.DATA_GOLDEN_WRITE === "1") {
  assert(!existsSync(GOLDEN), "the golden file exists: it is written once, from the base code");
  writeFileSync(GOLDEN, JSON.stringify({
    _how: "Written by `DATA_GOLDEN_WRITE=1 node server/data-templates-test.mjs` on the unmodified base code (branch main-split, c0d1c72), before any Stage B data migration. Never regenerate on migrated code.",
    content: content.content, maps: content.maps, worlds,
  }, null, 1) + "\n");
  console.log(`wrote ${GOLDEN}: ${worlds.length} worlds, ${Object.keys(content.maps).length} interior hashes`);
  process.exit(0);
}

const golden = JSON.parse(readFileSync(GOLDEN, "utf8"));
let fails = 0;
const check = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};

// 1. Worlds.
const FIELDS = ["counts", "tiles", "biomes", "owners", "sites", "hearths", "mobs", "regionPlan", "landmarks", "save"];
assert.equal(worlds.length, golden.worlds.length);
for (let k = 0; k < worlds.length; k++) {
  const a = worlds[k];
  const g = golden.worlds[k];
  assert.deepEqual([a.size, a.seed, a.version], [g.size, g.seed, g.version]);
  const same = FIELDS.filter((f) => JSON.stringify(a[f]) === JSON.stringify(g[f]));
  const diff = FIELDS.filter((f) => !same.includes(f));
  check(diff.length === 0, `world ${a.size} seed ${a.seed} v${a.version}: ${same.length}/${FIELDS.length} hashes match (sites ${a.counts.sites}, mobs ${a.counts.mobs}, draws ${a.counts.draws})${diff.length ? " DIFF " + diff.join(", ") : ""}`);
}

// 2. Content and interiors.
for (const group of Object.keys(golden.content)) {
  for (const name of Object.keys(golden.content[group])) {
    const ok = JSON.stringify(content.content[group]?.[name]) === JSON.stringify(golden.content[group][name]);
    check(ok, `content ${group}.${name} identical`);
  }
}
const keys = Object.keys(golden.maps);
const sameMaps = keys.filter((k) => content.maps[k] === golden.maps[k]);
check(sameMaps.length === keys.length && Object.keys(content.maps).length === keys.length, `interior maps / validations: ${sameMaps.length}/${keys.length} hashes match${sameMaps.length < keys.length ? " DIFF " + keys.filter((k) => !sameMaps.includes(k)).join(", ") : ""}`);
const perTemplate = {};
for (const k of keys) {
  const id = k.split("/")[0];
  perTemplate[id] ??= [0, 0];
  perTemplate[id][1]++;
  if (content.maps[k] === golden.maps[k]) perTemplate[id][0]++;
}
console.log("interior hashes per template: " + Object.entries(perTemplate).map(([id, [a, b]]) => `${id} ${a}/${b}`).join(", "));

// 3. Loaders / validators.
if (existsSync(path.join(dir, "data-templates-loaders.mts"))) {
  const r = await probe({}, "DATALOADERS", "data-templates-loaders.mts");
  process.stdout.write(r.out.split("\n").filter((l) => l.startsWith("PASS") || l.startsWith("FAIL")).join("\n") + "\n");
  check(r.value.fails === 0, `loaders / validators: ${r.value.passes} checks pass, ${r.value.fails} fail`);
}

assert.equal(fails, 0, `${fails} check(s) failed`);
console.log(`PASS data-templates: ${worlds.length} worlds and ${keys.length} interior hashes identical to the base code`);
process.exit(0);
