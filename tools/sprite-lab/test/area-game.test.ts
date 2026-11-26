// Area tab vs the GAME'S OWN server code (child processes with the repo's tsx, scratch folders only, no game server, no
// port): (1) templates saved by the Lab load through the game's template stores (the boot loaders) and the game's own
// save writes byte-identical files; (2) the real server stamper (server/stamper/worker.ts -> stampCamp /
// stampSettlement) lays exactly the cells the Lab's shared-code preview shows, for every transform world-gen may use.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startLab, type Lab } from "../server/lab.ts";
import { loadArea } from "../server/game.ts";
import { realStamp } from "../server/stamp.ts";
import { buildingLookup } from "../server/templates.ts";
import { scratchRoot, write, REPO_DIR } from "./helpers.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let lab: Lab, root: string, base: string;
const builtin = async (k: string, id: string) => JSON.parse(await readFile(path.join(REPO_DIR, "server/data", k, id + ".json"), "utf8"));

before(async () => {
  root = await scratchRoot({ templates: true });
  lab = await startLab({ root, port: 31813, vite: false });
  base = lab.url;
});
after(async () => { await lab.close(); await rm(root, { recursive: true, force: true }); });

function probe(env: Record<string, string>, input: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, ["--import", import.meta.resolve("tsx"), "--import", path.join(HERE, "../server/stamper/alias.mjs"), path.join(HERE, "game-store-probe.ts")], {
      cwd: path.join(REPO_DIR, "server"), env: { PATH: process.env.PATH || "", COLONY_TEST_HOOKS: "1", ...env }, timeout: 60_000, maxBuffer: 16 << 20,
    }, (err, stdout, stderr) => {
      const i = String(stdout).lastIndexOf("@@RESULT@@");
      if (i < 0) return reject(new Error(`probe failed: ${err?.message}\n${stderr}`));
      resolve({ ...JSON.parse(String(stdout).slice(i + 10)), log: String(stdout).slice(0, i) });
    });
    child.stdin!.end(JSON.stringify(input));
  });
}

test("Lab-saved user templates load through the game's own template stores; the game's save writes the same bytes", async () => {
  const camp = { ...(await builtin("camps", "t1-tent-circle")), id: "lab-camp", name: "Lab camp" };
  camp.rows = camp.rows.map((r: string, y: number) => (y === 0 ? "b" + r.slice(1) : r));
  const building = { ...(await builtin("buildings", "house-cottage")), id: "lab-cottage", name: "Lab cottage" };
  const settlement = { ...(await builtin("settlements", "village-green")), id: "lab-village", name: "Lab village" };
  for (const [k, t] of [["camps", camp], ["buildings", building], ["settlements", settlement]] as const) {
    const r = await write(base, `api/templates/${k}/save`, { template: t });
    assert.equal(r.status, 200, `${k}: ${r.body.toString()}`);
  }
  const scratch = await mkdtemp(path.join(os.tmpdir(), "sprite-lab-probe-"));
  try {
    const user = (k: string) => path.join(root, "server/data", k, "user");
    const out = (k: string) => path.join(scratch, "store-" + k);
    const r = await probe({
      COLONY_SAVE_DIR: path.join(scratch, "saves"), COLONY_WORLD_SIZE: "96",
      COLONY_CAMP_USER_DIR: user("camps"), COLONY_BUILDING_USER_DIR: user("buildings"), COLONY_SETTLEMENT_USER_DIR: user("settlements"),
      PROBE_SAVE_CAMPS: out("camps"), PROBE_SAVE_BUILDINGS: out("buildings"), PROBE_SAVE_SETTLEMENTS: out("settlements"),
    }, { save: [{ kind: "settlements", template: settlement }, { kind: "camps", template: camp }, { kind: "buildings", template: building }] });
    assert.equal(r.sharedFrom, "file://" + path.join(REPO_DIR, "shared/src/protocol.ts"));
    assert.deepEqual(r.loaded.camps.map((t: { id: string }) => t.id), ["lab-camp"]);
    assert.deepEqual(r.loaded.buildings.map((t: { id: string }) => t.id), ["lab-cottage"]);
    assert.deepEqual(r.loaded.settlements.map((t: { id: string }) => t.id), ["lab-village"]);
    assert.ok(!/skipping user template/.test(r.log), r.log);
    assert.deepEqual(r.saved, [null, null, null]);
    for (const [k, id] of [["camps", "lab-camp"], ["buildings", "lab-cottage"], ["settlements", "lab-village"]]) {
      assert.equal(await readFile(path.join(user(k), id + ".json"), "utf8"), await readFile(path.join(out(k), id + ".json"), "utf8"), `${k}: Lab file = game store file`);
    }
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test("real server stamper = the shared-code preview, camps (all 8 transforms of one, first / last of 3 more)", async () => {
  const A = await loadArea();
  for (const id of ["t2-palisade-ring", "t1-forest-camp", "t3-iron-keep", "region-bandit-walled-1"]) {
    const t = await builtin("camps", id), all = A.campTransforms(t);
    for (const tf of id === "t2-palisade-ring" ? all : [all[0], all[all.length - 1]]) {
      const real = await realStamp(root, { kind: "camps", template: t, transform: tf, seed: 3 + tf });
      assert.equal(real.ok, true, `${id}/${tf}: ${real.errors}`);
      const p = A.campPreview(t, tf), m = real.margin;
      assert.equal(real.w, p.w + 2 * m);
      for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
        const want = p.cells[y * p.w + x].tile, got = real.tiles[(y + m) * real.w + x + m];
        assert.equal(got, want < 0 ? A.TileType.Empty : want, `${id}/${tf} tile at ${x},${y}`);
      }
      assert.deepEqual({ x: real.hearth.x - m, y: real.hearth.y - m }, p.hearth);
      const guardSlots = new Set(p.slots.filter((s) => s.kind === "guard").map((s) => `${s.x},${s.y}`));
      for (const g of real.mobs) assert.ok(guardSlots.has(`${g.x - m},${g.y - m}`), `${id}/${tf}: guard on a slot`);
      assert.ok(real.mobs.length >= t.guards[0] && real.mobs.length <= Math.min(t.guards[1], guardSlots.size));
    }
  }
});

test("real server stamper = the shared-code preview, settlements (tiles + ownership, two transforms each)", async () => {
  const A = await loadArea();
  const lookup = await buildingLookup(root);
  for (const id of ["hamlet-chapel", "village-green", "town-citadel", "town-moat"]) {
    const t = await builtin("settlements", id);
    const tfs = A.settlementTransforms(t, lookup);
    for (const tf of [tfs[0], tfs[tfs.length - 1]]) {
      const real = await realStamp(root, { kind: "settlements", template: t, transform: tf, seed: 5 });
      assert.equal(real.ok, true, `${id}/${tf}: ${real.errors}`);
      assert.equal(real.fit, null);
      const p = A.settlementPreview(t, tf, lookup), d = real.margin - p.apron;
      assert.equal(real.site.apron, p.apron);
      let owned = 0;
      for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
        const c = p.cells[y * p.w + x], i = (y + d) * real.w + x + d;
        assert.equal(real.tiles[i], c.tile < 0 ? A.TileType.Empty : c.tile, `${id}/${tf} tile at ${x},${y}`);
        assert.equal(real.owned[i], c.owned ? 1 : 0, `${id}/${tf} owner at ${x},${y}`);
        owned += real.owned[i];
      }
      assert.ok(owned > 0);
      assert.deepEqual({ x: real.site.keep.x - d, y: real.site.keep.y - d }, p.keep);
      const g = Object.values(t.garrison as Record<string, number>).reduce((a, b) => a + b, 0);
      assert.equal(real.mobs.length, g);
    }
  }
});

test("the stamper refuses invalid templates with the game validator's reasons", async () => {
  const t = await builtin("camps", "t1-forest-camp");
  const r = await realStamp(root, { kind: "camps", template: { ...t, rows: t.rows.map((x: string) => x.replace("H", ".")) }, transform: 0, seed: 1 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e: string) => /hearth/.test(e)));
  const res = await write(base, "api/stamp", { kind: "buildings", template: {}, transform: 0 });
  assert.equal(res.status, 400);
});
