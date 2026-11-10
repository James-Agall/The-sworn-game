// Building templates test (no server boot, no ports): re-runs itself under tsx and drives the server modules in-process
// with a scratch COLONY_SAVE_DIR and a scratch user-template folder. Run from server/: `node building-templates-test.mjs`.
//   V every built-in validates; at least 2 per required type (gatehouse: 1); every template <= 15x15; the validator
//     refuses broken grids (two outside doors, furniture outside, an unreachable station, a role no room has); the
//     user store refuses invalid / built-in ids, saves, lists and deletes.
//   S every template x every allowed transform laid on an empty scratch map: the server's rooms (structures.ts) inside
//     the footprint have exactly the template's room roles (rooms.ts) and include its role; every room's walkable tile
//     and every station's side is reachable from outside through the one outside door.
//   O a blueprint order (placeBlueprint) in a normal game: all-or-nothing checks (in the way, too far, cost), one
//     construction site per piece paid up front, a station's "needs a roofed room" is met by its own walls, cancel
//     refunds, and the builders finish every piece; the finished rooms have the template's roles.
//   G (gap closure G8) keeps (one Keep anchor Y; none elsewhere), fenced animal yards (animal houses only, a gate in,
//     open ground + the animal house inside), gate passages (two outside doors per passage, guard rooms off it; the
//     one-door rule kept for ordinary buildings); a keep blueprint has the prefab Keep's gates (Town Center level 2,
//     one per settlement); a yard blueprint queues its fences and gate and the builders finish it.
//   E the building editor's creativeSet ops: buildingList, buildingSave (refuses invalid), buildingStamp (instant, the
//     player's clan), buildingDelete (refuses built-ins).
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));

if (process.env.BUILDING_TEST_INNER !== "1") {
  const TSX = [path.join(DIR, "node_modules/.bin/tsx"), path.join(DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
  const scratch = mkdtempSync(path.join(tmpdir(), "building-templates-"));
  const child = spawn(TSX, [fileURLToPath(import.meta.url)], {
    cwd: DIR,
    stdio: "inherit",
    env: {
      ...process.env, BUILDING_TEST_INNER: "1", COLONY_SAVE_DIR: path.join(scratch, "saves"), COLONY_TEST_HOOKS: "1", COLONY_UNLOCK_ALL: "1",
      COLONY_BUILDING_USER_DIR: path.join(scratch, "buildings-user"), COLONY_WORLD_SIZE: "96", COLONY_INSTANT_BUILD: "0",
    },
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
  const BT = await import("@colony/shared/buildingTemplates");
  const { transformRows } = await import("@colony/shared/camps");
  const bt = await import("./src/buildingTemplates.ts");
  const { state, constructionSites, colonists } = await import("./src/state.ts");
  const { markTileRegistryStale, setTile } = await import("./src/chunks.ts");
  const { findPath } = await import("./src/pathfinding.ts");
  const { allRooms } = await import("./src/structures.ts");
  const { resetWorld } = await import("./src/saves.ts");
  const { stepSimulation } = await import("./src/sim.ts");
  const { handleSiteOrder } = await import("./src/construction.ts");
  const { handleCreativeSet } = await import("./src/creative.ts");

  // ---- V ----
  bt.loadBuildingTemplates();
  const builtins = bt.buildingTemplates().filter((t) => t.builtin);
  const bad = builtins.filter((t) => BT.validateBuildingTemplate(t).length > 0);
  result(bad.length === 0, `V ${builtins.length} built-in templates validate${bad.length ? ": " + bad.map((t) => `${t.id}: ${BT.validateBuildingTemplate(t)[0]}`).join(" | ") : ""}`);
  const byType = {};
  for (const t of builtins) byType[t.buildingType] = (byType[t.buildingType] ?? 0) + 1;
  const thin = BT.BUILDING_TYPES.filter((k) => (byType[k] ?? 0) < (k === "gatehouse" || k === "abbey" || k === "longhouse" ? 1 : 2));
  result(thin.length === 0, `V variants per type (${Object.entries(byType).map(([k, n]) => `${k} ${n}`).join(", ")})${thin.length ? " missing: " + thin.join(",") : ""}`);
  result(builtins.every((t) => t.rows.length <= 15 && t.rows[0].length <= 15), "V every footprint <= 15x15");
  const base = { id: "x", name: "X", buildingType: "house", tier: 1, doorSide: "S", rotate: true, mirror: true, role: "bedroom" };
  const refuse = (rows, extra, why) => {
    const errs = BT.validateBuildingTemplate({ ...base, ...extra, rows });
    result(errs.length > 0, `V refuses ${why} (${errs[0] ?? "accepted!"})`);
  };
  refuse(["#+###", "#b=b#", "##+##"], {}, "two outside doors");
  refuse(["#####", "#b=b#", "##+##", "..x.."], {}, "furniture outside a room");
  refuse(["#####", "#=F%#", "#%%%#", "##+##"].map((r) => r), { role: "workshop" }, "an enclosed area that is not a room / unreachable station");
  refuse(["#####", "#b=b#", "##+##"], { role: "church" }, "a role no room has");
  refuse(["#####", "#b=b#", "##+##"], { doorSide: "N" }, "a door on the wrong side");
  refuse(["#####", "#===#", "##+##"], {}, "a room without a role");
  // Gap closure G8: keeps, yards, passages.
  const byId = (id) => builtins.find((t) => t.id === id);
  for (const id of ["keep-small", "keep-great", "coop-yard", "sty-yard", "pen-yard", "livestock-yard", "gatehouse-large", "gatehouse-double"]) result(!!byId(id), `G built-in ${id}`);
  const gst = (id) => BT.buildingStats(byId(id));
  result(gst("coop-yard").yards === 1 && gst("livestock-yard").yards === 1 && gst("gatehouse-large").passages === 1 && gst("gatehouse-double").passages === 2,
    "G stats: yards / passages counted");
  const gl = byId("gatehouse-large");
  refuse(gl.rows.map((r, y) => (y === gl.rows.length - 1 ? r.replace("D", "%") : r)), { buildingType: "gatehouse", role: "barracks" }, "a gate passage with one outside door");
  refuse(["#####fff", "#b=b#..f", "##+##fgf"], {}, "a fenced yard on a house");
  const cy = byId("coop-yard");
  refuse(cy.rows.map((r) => r.replace("g", "f")), { buildingType: "chickenCoop", role: "storeroom" }, "a yard with no gate");
  refuse(cy.rows.map((r, y) => (y === 2 ? r.slice(0, 5) + "x" + r.slice(6) : r)), { buildingType: "chickenCoop", role: "storeroom" }, "furniture in a yard");
  const ks = byId("keep-small");
  refuse(ks.rows.map((r) => r.replace("tYt", "YYt")), { buildingType: "keep", role: "hall" }, "a keep with two Keep anchors");
  refuse(ks.rows.map((r) => r.replace("Y", "=")), { buildingType: "keep", role: "hall" }, "a keep without its anchor");
  refuse(ks.rows, { buildingType: "hall", role: "hall" }, "a Keep anchor in a non-keep");
  const user = { ...builtins[0], id: "test-user-building", name: "Test building", builtin: undefined };
  result(bt.saveUserBuilding({ ...user, rows: ["..."] }) !== null, "V an invalid template is refused");
  result(bt.saveUserBuilding({ ...user, id: builtins[0].id }) !== null, "V a built-in's id is refused");
  result(bt.saveUserBuilding(user) === null && !!bt.buildingTemplateById("test-user-building"), "V a user template saves and lists");
  result(bt.deleteUserBuilding(builtins[0].id) !== null, "V a built-in can't be deleted");
  result(bt.deleteUserBuilding("test-user-building") === null && !bt.buildingTemplateById("test-user-building"), "V a user template deletes");

  // ---- S ----
  const W = state.WORLD_TILES_X;
  const idx = (x, y) => y * W + x;
  const C = { x: W >> 1, y: W >> 1 };
  const clearMap = () => {
    state.tiles.fill(TileType.Empty);
    state.siteGrounds?.fill?.(0);
    markTileRegistryStale();
  };
  let stamps = 0;
  const problems = [];
  const sorted = (a) => a.slice().sort().join(",");
  for (const t of builtins) {
    const transforms = [0, 1, 2, 3, 4, 5, 6, 7].filter((k) => (t.rotate || (k & 3) === 0) && (t.mirror || (k & 4) === 0));
    for (const k of transforms) {
      clearMap();
      const plan = bt.planBuilding(t, C, k);
      for (const p of plan.pieces) setTile(idx(p.x, p.y), p.tile);
      stamps++;
      const tag = `${t.id}/${k}`;
      const inFoot = (r) => r.x0 >= plan.x0 && r.y0 >= plan.y0 && r.x1 < plan.x0 + plan.w && r.y1 < plan.y0 + plan.h;
      const rooms = allRooms().filter(inFoot);
      const want = BT.buildingRoomRoles({ rows: transformRows(t.rows, k) });
      const got = rooms.map((r) => r.stats.role);
      if (sorted(want) !== sorted(got)) problems.push(`${tag}: rooms ${sorted(got)} vs ${sorted(want)}`);
      if (!got.includes(t.role)) problems.push(`${tag}: no ${t.role}`);
      const outside = { x: plan.x0 - 2, y: plan.y0 - 2 };
      for (const r of rooms) {
        const walk = r.tiles.find((i) => !isSolidTile(state.tiles[i]));
        if (walk === undefined || !findPath(outside, { x: walk % W, y: Math.floor(walk / W) })) problems.push(`${tag}: a ${r.stats.role} unreachable from outside`);
      }
    }
  }
  result(problems.length === 0, `S ${stamps} stamps of ${builtins.length} templates: room roles match, rooms reachable${problems.length ? ": " + problems.slice(0, 6).join(" | ") : ""}`);

  // ---- O ---- a normal game: blueprints, builders.
  resetWorld("normal", 96, false);
  state.testRaidsDisabled = true;
  state.instantBuild = false;
  const events = [];
  const player = { id: "p1", clan: 0, dead: false, x: 0, y: 0, socket: { readyState: 1, OPEN: 1, send: (m) => events.push(JSON.parse(m)) } };
  const tc = state.townCenters[0];
  // Natural clutter only (trees, rocks, bushes, ...): anything the colony built or owns is never cleared.
  const NATURAL = new Set([TileType.Tree, TileType.Rock, TileType.Bush, TileType.IronOre].filter((t) => t !== undefined));
  const isSolidBuilt = (t) => !NATURAL.has(t);
  player.x = tc.x * 32 + 16;
  player.y = tc.y * 32 + 16;
  // A clear spot near the Town Center for a w x h footprint (plus a 2-tile ring). Gap closure G8: on a crowded random
  // map (trees / rocks everywhere) the second pass takes a spot with only natural clutter and clears it.
  const findSpot = (w, h, avoid = []) => {
    for (const clear of [false, true]) {
      for (let r = 4; r < 30; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const c = { x: tc.x + dx, y: tc.y + dy };
        const x0 = c.x - (w >> 1) - 2;
        const y0 = c.y - (h >> 1) - 2;
        let ok = !avoid.some((a) => Math.abs(a.x - c.x) < w + 4 && Math.abs(a.y - c.y) < h + 4);
        for (let y = y0; y < y0 + h + 4 && ok; y++) for (let x = x0; x < x0 + w + 4 && ok; x++) {
          const t = x > 0 && y > 0 && x < W - 1 && y < W - 1 ? state.tiles[idx(x, y)] : -1;
          ok = (t === TileType.Empty || (clear && t >= 0 && !isSolidBuilt(t))) && !constructionSites.has(`${x},${y}`);
        }
        if (!ok) continue;
        if (clear) for (let y = y0; y < y0 + h + 4; y++) for (let x = x0; x < x0 + w + 4; x++) if (state.tiles[idx(x, y)] !== TileType.Empty) setTile(idx(x, y), TileType.Empty);
        return c;
      }
    }
    return null;
  };
  const house = bt.buildingTemplateById("house-two-room");
  const smith = bt.buildingTemplateById("blacksmith-small");
  for (const k of Object.keys(state.stock)) state.stock[k] = 0;
  const hs = findSpot(house.rows[0].length, house.rows.length);
  const tooPoor = bt.handlePlaceBlueprint(player, house.id, hs.x, hs.y, 1);
  result(typeof tooPoor === "string" && /materials/.test(tooPoor) && constructionSites.size === 0, `O refused without materials (${tooPoor})`);
  Object.assign(state.stock, { wood: 2000, rock: 2000, iron: 500, tools: 50, wool: 100 });
  const far = bt.handlePlaceBlueprint(player, house.id, tc.x > W / 2 ? tc.x - 45 : tc.x + 45, tc.y, 0);
  result(typeof far === "string" && /Too far/.test(far) && constructionSites.size === 0, `O refused out of range (${far})`);
  const wood0 = state.stock.wood;
  const okHouse = bt.handlePlaceBlueprint(player, house.id, hs.x, hs.y, 1);
  const housePlan = bt.planBuilding(house, hs, 1);
  const sitesIn = (plan) => plan.pieces.filter((p) => constructionSites.has(`${p.x},${p.y}`)).length;
  const cost = BT.buildingCost(house);
  result(okHouse === null && sitesIn(housePlan) === housePlan.pieces.length && wood0 - state.stock.wood === cost.wood, `O house blueprint: ${sitesIn(housePlan)}/${housePlan.pieces.length} sites, ${wood0 - state.stock.wood} wood paid (template ${cost.wood})`);
  const again = bt.handlePlaceBlueprint(player, smith.id, hs.x, hs.y, 0);
  result(typeof again === "string", `O refused on top of another blueprint (${again})`);
  const ss = findSpot(smith.rows[0].length, smith.rows.length, [hs]);
  const okSmith = bt.handlePlaceBlueprint(player, smith.id, ss.x, ss.y, 0);
  const smithPlan = bt.planBuilding(smith, ss, 0);
  const forge = smithPlan.pieces.find((p) => p.tile === TileType.Blacksmith);
  result(okSmith === null && constructionSites.get(`${forge.x},${forge.y}`)?.target === TileType.Blacksmith, "O a station blueprint is accepted before its room stands (its own walls are queued)");
  // Gap closure G1: a template with 2-tile beds (the infirmary, turned): each bed is one site at its anchor, its part
  // tile stamped with it (no site, no cost of its own).
  const hosp = bt.buildingTemplateById("hospital-infirmary");
  const hsp = findSpot(6, 9, [hs, ss]);
  const okHosp = bt.handlePlaceBlueprint(player, hosp.id, hsp.x, hsp.y, 1);
  const hPlan = bt.planBuilding(hosp, hsp, 1);
  const parts = hPlan.pieces.filter((p) => p.tile === TileType.FurniturePartW || p.tile === TileType.FurniturePartN);
  const bedSites = hPlan.pieces.filter((p) => p.tile === TileType.Bed && constructionSites.get(`${p.x},${p.y}`)?.target === TileType.Bed).length;
  result(okHosp === null && parts.length === 3 && parts.every((p) => state.tiles[idx(p.x, p.y)] === p.tile && !constructionSites.has(`${p.x},${p.y}`)) && bedSites === 3,
    `O infirmary blueprint (turned): ${bedSites} bed sites, ${parts.length} part tiles stamped (${okHosp ?? "ok"})`);

  // Gap closure G8: a keep blueprint (the prefab Keep's gates) and a yard blueprint (fences + gate queued).
  const keepT = bt.buildingTemplateById("keep-small");
  const ks0 = findSpot(keepT.rows[0].length, keepT.rows.length, [hs, ss, hsp]);
  tc.level = 1;
  const keepLow = bt.handlePlaceBlueprint(player, keepT.id, ks0.x, ks0.y, 0);
  result(typeof keepLow === "string" && /Town Center at level 2/.test(keepLow), `G keep blueprint refused below Town Center level 2 (${keepLow})`);
  tc.level = 2;
  const keepOk = bt.handlePlaceBlueprint(player, keepT.id, ks0.x, ks0.y, 0);
  const keepPlan = bt.planBuilding(keepT, ks0, 0);
  const anchor = keepPlan.pieces.find((p) => p.tile === TileType.Keep);
  result(keepOk === null && constructionSites.get(`${anchor.x},${anchor.y}`)?.target === TileType.Keep && sitesIn(keepPlan) === keepPlan.pieces.length,
    `G keep blueprint at Town Center level 2: ${sitesIn(keepPlan)}/${keepPlan.pieces.length} sites, the anchor a Keep site (${keepOk ?? "ok"})`);
  const ks1 = findSpot(keepT.rows[0].length, keepT.rows.length, [hs, ss, hsp, ks0]);
  const keepTwo = ks1 ? bt.handlePlaceBlueprint(player, keepT.id, ks1.x, ks1.y, 0) : "no spot";
  result(typeof keepTwo === "string" && /already has a Keep/.test(keepTwo), `G a second keep in the settlement is refused (${keepTwo})`);
  const coop = bt.buildingTemplateById("coop-yard");
  const cs0 = findSpot(coop.rows.length, coop.rows[0].length, [hs, ss, hsp, ks0, ...(ks1 ? [ks1] : [])]);
  const okCoop = bt.handlePlaceBlueprint(player, coop.id, cs0.x, cs0.y, 3);
  const coopPlan = bt.planBuilding(coop, cs0, 3);
  const fences = coopPlan.pieces.filter((p) => p.tile === TileType.PropFence);
  result(okCoop === null && fences.length > 0 && fences.every((p) => constructionSites.get(`${p.x},${p.y}`)?.target === TileType.PropFence)
    && coopPlan.pieces.some((p) => p.tile === TileType.Gate && constructionSites.get(`${p.x},${p.y}`)?.target === TileType.Gate),
    `G yard blueprint (turned): ${fences.length} fence + gate sites (${okCoop ?? "ok"})`);

  // Cancel one wall: refunded.
  const wall = housePlan.pieces.find((p) => p.tile === TileType.Wall);
  const w1 = state.stock.wood;
  handleSiteOrder(player, wall.x, wall.y, "cancel");
  result(!constructionSites.has(`${wall.x},${wall.y}`) && state.stock.wood - w1 === 3, `O cancelling a wall blueprint refunds it (+${state.stock.wood - w1} wood)`);
  // Re-order the house: only the missing piece goes down.
  bt.handlePlaceBlueprint(player, house.id, hs.x, hs.y, 1);
  result(constructionSites.has(`${wall.x},${wall.y}`), "O re-ordering the blueprint fills the gap only");
  const builders = Array.from(colonists.values()).filter((c) => c.kind === "builder").length;
  let ticks = 0;
  const pending = () => sitesIn(housePlan) + sitesIn(smithPlan) + sitesIn(coopPlan);
  while (pending() > 0 && ticks < 60000) {
    for (let i = 0; i < 500; i++) stepSimulation();
    ticks += 500;
  }
  result(pending() === 0, `O ${builders} builders finish both blueprints (${ticks} ticks, ${pending()} left)`);
  const roomsOf = (plan) => allRooms().filter((r) => r.x0 >= plan.x0 && r.y0 >= plan.y0 && r.x1 < plan.x0 + plan.w && r.y1 < plan.y0 + plan.h).map((r) => r.stats.role);
  result(sorted(roomsOf(housePlan)) === sorted(BT.buildingRoomRoles(house)), `O built house rooms: ${sorted(roomsOf(housePlan))}`);
  result(sorted(roomsOf(smithPlan)) === "workshop" && state.tiles[idx(forge.x, forge.y)] === TileType.Blacksmith, `O built smithy: ${sorted(roomsOf(smithPlan))}, forge stands`);
  result(sorted(roomsOf(coopPlan)) === "storeroom" && fences.every((p) => state.tiles[idx(p.x, p.y)] === TileType.PropFence) && coopPlan.pieces.some((p) => state.tiles[idx(p.x, p.y)] === TileType.ChickenCoop),
    `G built coop + yard: ${sorted(roomsOf(coopPlan))}, fences and the coop stand`);

  // ---- E ----
  const call = (msg) => {
    let out = null;
    handleCreativeSet(player, msg, (ok, text, data = {}) => (out = { ok, text, ...data }));
    return out;
  };
  const list = call({ op: "buildingList" });
  result(list.ok && list.templates.length === builtins.length, `E buildingList: ${list.templates.length}`);
  const draft = { ...bt.buildingTemplateById("house-cottage"), id: "editor-house", name: "Editor house", builtin: undefined };
  const badSave = call({ op: "buildingSave", template: { ...draft, rows: draft.rows.map((r) => r.replace("+", "#")) } });
  const saved = call({ op: "buildingSave", template: draft });
  result(!badSave.ok && saved.ok && saved.templates.some((t) => t.id === "editor-house"), `E buildingSave refuses a doorless one, saves a valid one (${badSave.text})`);
  const sp = findSpot(5, 5, [hs, ss]);
  const st = call({ op: "buildingStamp", id: "editor-house", x: sp.x * 32 + 16, y: sp.y * 32 + 16, transform: 0 });
  const stPlan = bt.planBuilding(draft, sp, 0);
  result(st.ok && stPlan.pieces.every((p) => state.tiles[idx(p.x, p.y)] === p.tile) && sorted(roomsOf(stPlan)) === "bedroom", `E buildingStamp builds at once (${st.text})`);
  const st2 = call({ op: "buildingStamp", id: "editor-house", x: sp.x * 32 + 16, y: sp.y * 32 + 16 });
  result(!st2.ok, `E stamping on top is refused (${st2.text})`);
  const delB = call({ op: "buildingDelete", id: builtins[0].id });
  const del = call({ op: "buildingDelete", id: "editor-house" });
  result(!delB.ok && del.ok && !del.templates.some((t) => t.id === "editor-house"), "E buildingDelete: built-in refused, user template deleted");

  console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
}
