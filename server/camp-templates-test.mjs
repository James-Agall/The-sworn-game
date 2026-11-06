// Camp templates test (no server boot, no ports): re-runs itself under tsx and drives the server modules in-process on
// a scratch map, with a scratch COLONY_SAVE_DIR and a scratch user-template folder. Run from server/:
// `node camp-templates-test.mjs`.
//   V every built-in template validates; at least 3 per tier; the user store refuses invalid / built-in ids, saves,
//     lists and deletes a user template.
//   S every template x every allowed transform stamps on an empty scratch map ringed by water just outside its
//     clearance: no water in the footprint, every tile cell laid, the hearth (campfire, tier HP) registered, guards
//     counted within the template's range on its guard slots, prisoners within the prisoner slots, chests counted, the
//     hearth reachable from outside and every guard able to walk out. Water one tile closer fails campSpotOk.
//   D generateWorld(seed) twice gives the same tiles and the same camps; another seed differs; every camp hearth
//     comes from a template; all three tiers appear on a 160 map; an 80 map generates too.
//   B destroying a templated camp's hearth burns its props within its radius and pays its chests' loot.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));

if (process.env.CAMP_TEST_INNER !== "1") {
  const TSX = [path.join(DIR, "node_modules/.bin/tsx"), path.join(DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
  const scratch = mkdtempSync(path.join(tmpdir(), "camp-templates-"));
  const child = spawn(TSX, [fileURLToPath(import.meta.url)], {
    cwd: DIR,
    stdio: "inherit",
    env: { ...process.env, CAMP_TEST_INNER: "1", COLONY_SAVE_DIR: path.join(scratch, "saves"), COLONY_CAMP_USER_DIR: path.join(scratch, "camps-user"), COLONY_WORLD_SIZE: "160" },
  });
  child.on("exit", (code) => {
    rmSync(scratch, { recursive: true, force: true });
    process.exit(code ?? 1);
  });
} else {
  await inner();
}

async function inner() {
  let fails = 0;
  const result = (ok, msg) => {
    if (!ok) fails++;
    console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
  };
  const { TileType, isSolidTile } = await import("@colony/shared/protocol");
  const { CAMP_LEGEND, campCells, campRadius, campStats, transformOffset, validateCampTemplate } = await import("@colony/shared/camps");
  const camps = await import("./src/camps.ts");
  const wg = await import("./src/worldgen.ts");
  const { state, mobs, hearths, colonists, wildlife } = await import("./src/state.ts");
  const { markTileRegistryStale } = await import("./src/chunks.ts");
  const { findPath } = await import("./src/pathfinding.ts");
  const { hearthApproachTile, destroyHearth } = await import("./src/hearths.ts");
  const { CAMP_HEARTH_HP_BY_TIER, CAMP_CHEST_LOOT, HEARTH_LOOT_PER_GUARDIAN } = await import("./src/constants.ts");

  // ---- V ----
  camps.loadCampTemplates();
  const all = camps.campTemplates();
  const builtins = all.filter((t) => t.builtin);
  result(builtins.every((t) => validateCampTemplate(t).length === 0), `V ${builtins.length} built-in templates validate`);
  for (const tier of [1, 2, 3]) {
    const n = builtins.filter((t) => t.tier === tier).length;
    result(n >= 3, `V tier ${tier}: ${n} built-in templates`);
  }
  const user = { ...builtins[0], id: "test-user-camp", name: "Test camp", builtin: undefined };
  result(camps.saveUserCamp({ ...user, rows: ["....."] }) !== null, "V an invalid template is refused");
  result(camps.saveUserCamp({ ...user, id: builtins[0].id }) !== null, "V a built-in's id is refused");
  result(camps.saveUserCamp(user) === null && !!camps.campTemplateById("test-user-camp"), "V a user template saves and lists");
  result(camps.deleteUserCamp(builtins[0].id) !== null, "V a built-in can't be deleted");
  result(camps.deleteUserCamp("test-user-camp") === null && !camps.campTemplateById("test-user-camp"), "V a user template deletes");

  // ---- S ----
  const W = state.WORLD_TILES_X;
  const C = { x: Math.floor(W / 2), y: Math.floor(W / 2) };
  const idx = (x, y) => y * W + x;
  const scratchMap = (waterAt) => {
    state.tiles.fill(TileType.Empty);
    markTileRegistryStale();
    mobs.clear();
    hearths.clear();
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      if (Math.max(Math.abs(x - C.x), Math.abs(y - C.y)) >= waterAt) state.tiles[idx(x, y)] = TileType.Water;
    }
    markTileRegistryStale();
  };
  let stamped = 0;
  const problems = [];
  for (const t of builtins) {
    const r = campRadius(t);
    const st = campStats(t);
    const transforms = [0, 1, 2, 3, 4, 5, 6, 7].filter((k) => (t.rotate || (k & 3) === 0) && (t.mirror || (k & 4) === 0));
    scratchMap(r + 1);
    if (wg.campSpotOk(C, r)) problems.push(`${t.id}: spot ok with water at r+1`);
    for (const k of transforms) {
      scratchMap(r + 2);
      if (!wg.campSpotOk(C, r)) {
        problems.push(`${t.id}/${k}: spot refused with water at r+2`);
        continue;
      }
      const camp = camps.stampCamp(t, C, k);
      stamped++;
      const tag = `${t.id}/${k}`;
      const cells = campCells(t, k);
      for (const c of cells) {
        const want = CAMP_LEGEND[c.ch].tile;
        const got = state.tiles[idx(C.x + c.dx, C.y + c.dy)];
        if (got === TileType.Water) problems.push(`${tag}: water at ${c.dx},${c.dy}`);
        if (want !== undefined && got !== want) problems.push(`${tag}: tile ${got} not ${want} at ${c.dx},${c.dy}`);
      }
      for (let y = C.y - r; y <= C.y + r; y++) for (let x = C.x - r; x <= C.x + r; x++) if (state.tiles[idx(x, y)] === TileType.Water) problems.push(`${tag}: water in footprint`);
      const h = hearths.get(camp.siteId);
      if (!h || h.x !== C.x || h.y !== C.y || state.tiles[idx(C.x, C.y)] !== TileType.PropCampfire) problems.push(`${tag}: no hearth on a campfire`);
      else {
        if (h.maxHp !== CAMP_HEARTH_HP_BY_TIER[t.tier - 1]) problems.push(`${tag}: hearth hp ${h.maxHp}`);
        if (!(h.prisoners >= 0 && h.prisoners <= st.prisonerSlots) || (st.prisonerSlots > 0 && h.prisoners === 0)) problems.push(`${tag}: ${h.prisoners} prisoners for ${st.prisonerSlots} slots`);
        if (h.campChests !== st.lootSlots || h.campTemplate !== t.id || h.campTier !== t.tier || h.campRadius !== r) problems.push(`${tag}: hearth camp fields`);
        if (h.garrison !== camp.guards.length) problems.push(`${tag}: garrison ${h.garrison} vs ${camp.guards.length}`);
      }
      const g = camp.guards.length;
      if (g < t.guards[0] || g > Math.min(t.guards[1], st.guardSlots)) problems.push(`${tag}: ${g} guards outside ${t.guards}`);
      const slotKeys = new Set(cells.filter((c) => CAMP_LEGEND[c.ch].slot === "guard").map((c) => `${C.x + c.dx},${C.y + c.dy}`));
      const outside = { x: C.x - r - 1, y: C.y };
      for (const m of camp.guards) {
        const tx = Math.floor(m.x / 32);
        const ty = Math.floor(m.y / 32);
        if (!slotKeys.has(`${tx},${ty}`)) problems.push(`${tag}: guard off its slots at ${tx},${ty}`);
        if (m.siteId !== camp.siteId || m.siteKind !== "encampment" || m.guardianActive) problems.push(`${tag}: guard site fields`);
        if (!findPath({ x: tx, y: ty }, outside)) problems.push(`${tag}: guard at ${tx},${ty} can't walk out`);
      }
      const ap = hearthApproachTile(C, outside.x * 32, outside.y * 32);
      if (!ap || isSolidTile(state.tiles[idx(ap.x, ap.y)]) || !findPath(outside, ap)) problems.push(`${tag}: hearth unreachable from outside`);
    }
  }
  result(problems.length === 0, `S ${stamped} stamps of ${builtins.length} templates${problems.length ? ": " + problems.slice(0, 8).join(" | ") : ""}`);
  // transformOffset sanity: a quarter turn clockwise maps east to south; mirror flips x.
  const [ex, ey] = transformOffset(1, 0, 1);
  const [mx] = transformOffset(1, 0, 4);
  result(ex === 0 && ey === 1 && mx === -1, "S transform offsets (turn east -> south, mirror x)");

  // ---- D ----
  const gen = (seed) => {
    mobs.clear();
    colonists.clear();
    wildlife.clear();
    wg.generateWorld(seed);
    const list = Array.from(hearths.values()).filter((h) => h.siteKind === "encampment").map((h) => `${h.campTemplate}@${h.x},${h.y}:${h.prisoners}`).sort();
    return { tiles: Buffer.from(state.tiles).toString("base64"), list, hearths: Array.from(hearths.values()).filter((h) => h.siteKind === "encampment") };
  };
  const a = gen(12345);
  const b = gen(12345);
  const c = gen(999);
  result(a.tiles === b.tiles && JSON.stringify(a.list) === JSON.stringify(b.list), `D same seed -> same tiles and ${a.list.length} camps`);
  result(a.tiles !== c.tiles, "D another seed differs");
  result(a.hearths.length >= 5 && a.hearths.every((h) => h.campTemplate && camps.campTemplateById(h.campTemplate)), `D every camp hearth is templated (${a.hearths.length})`);
  const tiers = new Set([...a.hearths, ...c.hearths].map((h) => h.campTier));
  result(tiers.has(1) && tiers.has(2) && tiers.has(3), `D tiers on 160 maps: ${[...tiers].sort().join(",")}`);
  const nearStart = a.hearths.filter((h) => Math.hypot(h.x - W / 2, h.y - W / 2) <= 36);
  result(nearStart.length >= 1 && nearStart.every((h) => h.campTier === 1), `D near-start camps are tier 1 (${nearStart.length})`);

  // ---- B ---- (on world `c`: the first camp with chests)
  gen(999);
  const h = Array.from(hearths.values()).find((x) => x.siteKind === "encampment" && (x.campChests ?? 0) > 0);
  if (!h) result(false, "B a camp with loot chests");
  else {
    const r = h.campRadius;
    const burnable = new Set([TileType.PropCart, TileType.PropBarrel, TileType.PropCrate, TileType.PropFence, TileType.Tent, TileType.PropLanternPost]);
    const count = () => {
      let n = 0;
      for (let y = h.y - r; y <= h.y + r; y++) for (let x = h.x - r; x <= h.x + r; x++) if (burnable.has(state.tiles[idx(x, y)])) n++;
      return n;
    };
    const before = count();
    const gold0 = state.stock.gold;
    destroyHearth(h, "test");
    const gold = state.stock.gold - gold0;
    const want = HEARTH_LOOT_PER_GUARDIAN.gold * Math.max(1, h.garrison) + CAMP_CHEST_LOOT.gold * h.campChests;
    result(before > 0 && count() === 0 && state.tiles[idx(h.x, h.y)] === TileType.RuinRubble, `B ${before} props burned within radius ${r}, hearth to rubble`);
    result(gold === want, `B plunder gold ${gold} (want ${want}, ${h.campChests} chests)`);
  }

  // ---- 80 map ----
  wg.setWorldSize(80);
  const small = gen(4242);
  result(small.hearths.length >= 1, `D an 80 map generates ${small.hearths.length} camps`);

  console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
}
