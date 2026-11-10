// Settlement templates test (no server boot, no ports): re-runs itself under tsx and drives the server modules
// in-process with a scratch COLONY_SAVE_DIR and scratch user-template folders. Run from server/:
// `node settlement-templates-test.mjs`.
//   V every built-in validates against the building templates; 4+ per tier (hamlet / village / town, gap closure G7)
//     with a quest slot each, a riverside / hillside one and a moated town; the validator
//     refuses broken ones (two keeps, a building on a road, split roads, a hamlet with 9 buildings); the user store
//     saves, lists and deletes, refusing invalid / built-in ids.
//   S every template stamped on an empty scratch map: one SiteKeep (the site's keep / hearth) at its K, a human site
//     with the profile and layout, the garrison on the guard slots, roads one network touching the keep and every
//     gate, every building's door and every bed reachable on foot from outside by day, the rooms of each building
//     resolve to its template's roles, NPC homes: the trader / priest on their slots, villagers in beds.
//   T (gap closure G7) every built-in x every allowed whole-settlement transform: valid, and its composed tiles are
//     exactly the untransformed layout's tiles moved by transformPoint (keep, slots, beds and buildings follow).
//   Q (gap closure G7) the quest giver: a town's herald stands on the quest slot, talks with the town lines, its board
//     posts work (askWork), the "!" (questMarksFor) shows while a quest waits; the priest keeps its quest choices.
//   S stamps each template turned / mirrored (one of its transforms per template).
//   D generateWorld(seed) twice on a 256 map gives the same tiles and settlements; another seed differs; every
//     human site is templated with one keep; hamlets, villages and towns all appear; the save fields round-trip.
//   E the settlement editor's creativeSet ops: settlementList (+ the building templates), settlementSave (refuses
//     invalid), settlementStamp (a neutral settlement at the click), settlementDelete (refuses built-ins).
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));

if (process.env.SETTLEMENT_TEST_INNER !== "1") {
  const TSX = [path.join(DIR, "node_modules/.bin/tsx"), path.join(DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
  const scratch = mkdtempSync(path.join(tmpdir(), "settlement-templates-"));
  const child = spawn(TSX, [fileURLToPath(import.meta.url)], {
    cwd: DIR,
    stdio: "inherit",
    env: {
      ...process.env, SETTLEMENT_TEST_INNER: "1", COLONY_SAVE_DIR: path.join(scratch, "saves"), COLONY_TEST_HOOKS: "1",
      COLONY_BUILDING_USER_DIR: path.join(scratch, "buildings-user"), COLONY_SETTLEMENT_USER_DIR: path.join(scratch, "settlements-user"),
      COLONY_WORLD_SIZE: "160",
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
  const { TileType } = await import("@colony/shared/protocol");
  const ST = await import("@colony/shared/settlementTemplates");
  const BT = await import("@colony/shared/buildingTemplates");
  const bt = await import("./src/buildingTemplates.ts");
  const stt = await import("./src/settlementTemplates.ts");
  const wg = await import("./src/worldgen.ts");
  const { state, mobs, hearths, colonists, wildlife, sites, gates } = await import("./src/state.ts");
  const { markTileRegistryStale } = await import("./src/chunks.ts");
  const { findPath } = await import("./src/pathfinding.ts");
  const { allRooms } = await import("./src/structures.ts");
  const { clearSites, spawnSiteWorkers, sitesForSave, restoreSites } = await import("./src/sites.ts");
  const { clearOwners } = await import("./src/tiles.ts");
  const { DAY_TICKS } = await import("./src/constants.ts");

  // ---- V ----
  bt.loadBuildingTemplates();
  stt.loadSettlementTemplates();
  const lookup = bt.buildingTemplateById;
  const builtins = stt.settlementTemplates().filter((t) => t.builtin);
  const bad = builtins.filter((t) => ST.validateSettlementTemplate(t, lookup).length > 0);
  result(bad.length === 0, `V ${builtins.length} built-in settlement templates validate${bad.length ? ": " + bad.map((t) => `${t.id}: ${ST.validateSettlementTemplate(t, lookup)[0]}`).join(" | ") : ""}`);
  for (const tier of [1, 2, 3]) {
    const n = builtins.filter((t) => t.tier === tier).length;
    result(n >= 4, `V ${ST.SETTLEMENT_TIER_LABEL[tier]}: ${n} built-in templates`);
  }
  const noQuest = builtins.filter((t) => !t.rows.some((r) => r.includes("q")));
  result(noQuest.length === 0, `V every built-in has a quest giver slot q${noQuest.length ? ": missing " + noQuest.map((t) => t.id).join(",") : ""}`);
  result(builtins.some((t) => t.rows.some((r) => r.includes("~"))) && builtins.some((t) => t.rows.some((r) => r.includes("R")) && /hill/.test(t.id))
    && builtins.some((t) => t.tier === 3 && t.rows.some((r) => r.includes("m")) && t.rows.some((r) => r.includes("H"))), "V a riverside, a hillside and a moated town (drawbridges) among the built-ins");
  result(builtins.some((t) => t.rotate === false) && ST.settlementTransforms(builtins.find((t) => t.rotate === false), lookup).every((k) => (k & 3) === 0), "V a rotate:false template is only ever mirrored");

  // ---- T ---- whole-settlement transforms.
  {
    const tprob = [];
    let n = 0;
    for (const t of builtins) {
      const base = ST.settlementLayout(t, lookup);
      for (const k of ST.settlementTransforms(t, lookup)) {
        n++;
        const tt = ST.transformSettlement(t, k, lookup);
        const errs = ST.validateSettlementTemplate(tt, lookup);
        if (errs.length) {
          tprob.push(`${t.id}/${k}: ${errs[0]}`);
          continue;
        }
        const l = ST.settlementLayout(tt, lookup);
        let bad = 0;
        for (let y = 0; y < base.h; y++) for (let x = 0; x < base.w; x++) {
          const p = ST.transformPoint(x, y, base.w, base.h, k);
          if (l.tiles[p.y * l.w + p.x] !== base.tiles[y * base.w + x]) bad++;
        }
        const kp = ST.transformPoint(base.keep.x, base.keep.y, base.w, base.h, k);
        if (bad || l.keep.x !== kp.x || l.keep.y !== kp.y || l.slots.length !== base.slots.length || l.beds.length !== base.beds.length) tprob.push(`${t.id}/${k}: ${bad} tiles off`);
      }
    }
    result(tprob.length === 0, `T ${n} turned / mirrored layouts valid, tiles / keep / slots / beds follow${tprob.length ? ": " + tprob.slice(0, 6).join(" | ") : ""}`);
  }
  const ham = builtins.find((t) => t.tier === 1);
  const refuse = (t, why) => {
    const errs = ST.validateSettlementTemplate(t, lookup);
    result(errs.length > 0, `V refuses ${why} (${errs[0] ?? "accepted!"})`);
  };
  refuse({ ...ham, rows: ham.rows.map((r, y) => (y === 0 ? "K" + r.slice(1) : r)) }, "two keeps");
  const road = (() => {
    for (let y = 0; y < ham.rows.length; y++) {
      const x = ham.rows[y].indexOf("_");
      if (x >= 0) return { x, y };
    }
  })();
  refuse({ ...ham, buildings: [...ham.buildings, { ref: "house-hut", x: Math.max(0, road.x - 1), y: road.y }] }, "a building on a road");
  refuse({ ...ham, buildings: Array.from({ length: 9 }, () => ham.buildings[0]) }, "a hamlet with 9 buildings (and overlaps)");
  const split = ham.rows.map((r) => r.replace(/_/g, "."));
  split[road.y] = split[road.y].slice(0, road.x) + "_" + split[road.y].slice(road.x + 1);
  refuse({ ...ham, rows: split.map((r, y) => (y === 0 ? "_" + r.slice(1) : r)) }, "two road networks");
  const user = { ...ham, id: "test-user-hamlet", name: "Test hamlet", builtin: undefined };
  result(stt.saveUserSettlement({ ...user, rows: ["..."] }) !== null, "V an invalid template is refused");
  result(stt.saveUserSettlement({ ...user, id: ham.id }) !== null, "V a built-in's id is refused");
  result(stt.saveUserSettlement(user) === null && !!stt.settlementTemplateById("test-user-hamlet"), "V a user template saves and lists");
  result(stt.deleteUserSettlement(ham.id) !== null && stt.deleteUserSettlement("test-user-hamlet") === null && !stt.settlementTemplateById("test-user-hamlet"), "V built-in delete refused, user template deleted");

  // ---- S ----
  const W = state.WORLD_TILES_X;
  const idx = (x, y) => y * W + x;
  state.cycleTick = Math.floor(DAY_TICKS / 2);
  const problems = [];
  for (const [n, t0] of builtins.entries()) {
    const tfs = ST.settlementTransforms(t0, lookup);
    const tf = tfs[(n + 1) % tfs.length];
    const t = ST.transformSettlement(t0, tf, lookup);
    state.tiles.fill(TileType.Empty);
    markTileRegistryStale();
    mobs.clear();
    hearths.clear();
    clearOwners();
    clearSites();
    gates.clear();
    const x0 = 20;
    const y0 = 20;
    const tag = `${t.id}/${tf}`;
    const prob = (m) => problems.push(`${tag}: ${m}`);
    const fit = (await import("./src/sites.ts")).siteFitProblem(t, x0, y0);
    if (fit) {
      prob(`no fit: ${fit}`);
      continue;
    }
    const s = stt.stampSettlement(t, x0, y0);
    const l = ST.settlementLayout(t, lookup);
    const w = l.w;
    const h = l.h;
    let keeps = 0;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (state.tiles[idx(x, y)] === TileType.SiteKeep) keeps++;
    if (keeps !== 1 || s.keepX !== x0 + l.keep.x || s.keepY !== y0 + l.keep.y) prob(`${keeps} keeps`);
    if (s.faction !== "human" || s.template !== t.profile || s.layout !== t.id || !hearths.get(s.id)) prob("site fields");
    const want = Object.values(t.garrison).reduce((a, v) => a + v, 0);
    const guardKeys = new Set(l.slots.filter((q) => q.kind === "guard").map((q) => `${x0 + q.x},${y0 + q.y}`));
    if (s.garrison.length !== want) prob(`garrison ${s.garrison.length} vs ${want}`);
    for (const id of s.garrison) {
      const m = mobs.get(id);
      if (!m || !guardKeys.has(`${Math.floor(m.x / 32)},${Math.floor(m.y / 32)}`)) prob("a guard off its slots");
    }
    // Roads: one network (gates join) touching the keep and every gate.
    const isRoad = (i) => state.tiles[i] === TileType.Road || state.tiles[i] === TileType.CobbleRoad;
    const seen = new Set();
    let comps = 0;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      if (!isRoad(idx(x, y)) || seen.has(idx(x, y))) continue;
      comps++;
      const q = [idx(x, y)];
      seen.add(idx(x, y));
      while (q.length) {
        const c = q.pop();
        for (const n of [c + 1, c - 1, c + W, c - W]) if (!seen.has(n) && (isRoad(n) || state.tiles[n] === TileType.Gate)) {
          seen.add(n);
          q.push(n);
        }
      }
    }
    if (comps !== 1) prob(`${comps} road networks`);
    const k = idx(s.keepX, s.keepY);
    if (![k + 1, k - 1, k + W, k - W].some(isRoad)) prob("keep off the road");
    // On foot from outside the grounds, by day (neutral gates open, doors pass).
    const outside = { x: x0 - 2, y: y0 - 2 };
    const reach = (x, y) => !!findPath(outside, { x, y });
    for (const b of t.buildings) {
      const { cells } = BT.buildingCells(lookup(b.ref), b.transform ?? 0);
      const door = cells.find((c) => c.tile === TileType.WoodDoor || c.tile === TileType.StoneDoor);
      if (!reach(x0 + b.x + door.x, y0 + b.y + door.y)) prob(`${b.ref} door unreachable`);
      // Rooms: the building's footprint holds its template's roles.
      const { w: bw, h: bh } = BT.buildingCells(lookup(b.ref), b.transform ?? 0);
      const bx0 = x0 + b.x;
      const by0 = y0 + b.y;
      const roles = allRooms().filter((r) => r.x0 >= bx0 && r.y0 >= by0 && r.x1 < bx0 + bw && r.y1 < by0 + bh).map((r) => r.stats.role).sort().join(",");
      const wantRoles = BT.buildingRoomRoles(lookup(b.ref)).sort().join(",");
      if (roles !== wantRoles) prob(`${b.ref} rooms ${roles} vs ${wantRoles}`);
    }
    for (const bd of l.beds) if (!reach(x0 + bd.x, y0 + bd.y)) prob("a bed unreachable");
    // NPC homes and workers.
    const tr = l.slots.find((q) => q.kind === "trader");
    if (s.homes?.trader !== idx(x0 + tr.x, y0 + tr.y) || !(s.homes?.villagers.length >= l.beds.length)) prob("homes");
    spawnSiteWorkers(s);
    const ws = s.workers.map((id) => mobs.get(id));
    if (ws.length === 0 || ws[0].workB !== s.homes.trader) prob(`first worker (the trader) not at the trader slot (${ws.length} workers)`);
    const priest = ws.find((m) => m.siteWorker === "priest");
    if (priest && s.homes.priest !== undefined && priest.workB !== s.homes.priest) prob("priest not at the priest slot");
    if (ws.slice(1).some((m) => m.siteWorker !== "priest" && m.siteWorker !== "herald" && !s.homes.villagers.includes(m.workB))) prob("a villager not in a home");
    // Gap closure G7: the quest giver on the (turned) quest slot.
    const qs = l.slots.find((q) => q.kind === "quest");
    const herald = ws.find((m) => m.siteWorker === "herald");
    if (!qs || !herald || s.homes.quest !== idx(x0 + qs.x, y0 + qs.y) || herald.workB !== s.homes.quest || herald.kind !== "townHerald"
      || Math.floor(herald.x / 32) !== x0 + qs.x || Math.floor(herald.y / 32) !== y0 + qs.y) prob("no quest giver on the quest slot");
  }
  result(problems.length === 0, `S ${builtins.length} templates stamped: one keep, garrison on slots, roads, doors / beds reachable, rooms, homes${problems.length ? ": " + problems.slice(0, 8).join(" | ") : ""}`);

  // ---- Q ---- the quest giver.
  {
    const HL = await import("./src/herolife.ts");
    const { DIALOGUE } = await import("@colony/shared/herolife");
    state.tiles.fill(TileType.Empty);
    markTileRegistryStale();
    mobs.clear();
    hearths.clear();
    clearOwners();
    clearSites();
    gates.clear();
    const town = stt.settlementTemplateById("town-moat");
    const s = stt.stampSettlement(town, 20, 20);
    s.awake = true;
    s.sighted = true;
    spawnSiteWorkers(s);
    const herald = s.workers.map((id) => mobs.get(id)).find((m) => m.siteWorker === "herald");
    const sent = [];
    const player = { id: "qp", profileKey: "qp", clan: 0, dead: false, hp: 100, x: herald.x, y: herald.y, socket: { readyState: 1, OPEN: 1, send: (m) => sent.push(JSON.parse(m)) } };
    const last = () => sent.filter((m) => m.type === "dialogue" && m.dialogue).at(-1)?.dialogue;
    HL.startTalk(player, { role: "herald", name: "Herald X", d: 0, site: s, mob: herald });
    const d0 = last();
    result(!!d0 && d0.npc.roleLabel === "Quest giver" && /Hear ye/.test(d0.text) && d0.choices.some((c) => /work is posted/.test(c.label)) && d0.choices.some((c) => /new on the board/.test(c.label)),
      `Q the town herald talks: "${d0?.text.slice(0, 60)}..." (${d0?.choices.map((c) => c.label).join(" / ")})`);
    result(HL.heraldLines({ layout: "hamlet-riverside" }).title === "Reeve" && HL.heraldLines({ layout: "village-ford" }).title === "Bailiff", "Q hamlet reeve / village bailiff lines");
    const before = HL.questMarksFor(0).includes(herald.id);
    Object.keys(s.stock).forEach((k) => (s.stock[k] = 0));
    HL.handleDialogueChoice(player, d0.choices.findIndex((c) => /new on the board/.test(c.label)));
    const d1 = last();
    const { quests } = await import("./src/quests.ts");
    const mine = quests.filter((q) => q.siteId === s.id && q.clan === 0);
    result(mine.length >= 1 && /I'll do it/.test(d1.choices.map((c) => c.label).join("|")), `Q the board posts work: ${mine.map((q) => q.kind).join(",")} (${d1.text.split("\n")[0]})`);
    result(before && HL.questMarksFor(0).includes(herald.id), "Q the herald shows '!' (board open, then a quest waiting)");
    mine.forEach((q) => (q.accepted = true));
    s.diplo[0].questNextTick = state.cycleTick + 1000;
    result(!HL.questMarksFor(0).includes(herald.id), "Q no '!' once every quest is accepted and the board is on cooldown");
    result(DIALOGUE.questGiver.start.choices.some((c) => c.action === "quests") && DIALOGUE.herald.start.choices.some((c) => c.action === "quests"), "Q the priest keeps its quest offering beside the herald's");
  }

  // ---- D ----
  wg.setWorldSize(256);
  const gen = (seed) => {
    mobs.clear();
    colonists.clear();
    wildlife.clear();
    wg.generateWorld(seed);
    const human = Array.from(sites.values()).filter((s) => s.faction === "human");
    return { tiles: Buffer.from(state.tiles).toString("base64"), human, list: human.map((s) => `${s.layout}@${s.keepX},${s.keepY}`).sort() };
  };
  const a = gen(12345);
  const b = gen(12345);
  result(a.tiles === b.tiles && JSON.stringify(a.list) === JSON.stringify(b.list), `D same seed -> same tiles and settlements (${a.list.join(" ")})`);
  const c = gen(777);
  result(a.tiles !== c.tiles, "D another seed differs");
  const tiers = new Set();
  let oneKeep = true;
  let turned = 0;
  for (const seed of [12345, 777, 4242]) {
    const g = gen(seed);
    for (const s of g.human) {
      const t = stt.settlementTemplateById(s.layout);
      if (!t) {
        oneKeep = false;
        continue;
      }
      tiers.add(t.tier);
      const kl = ST.settlementLayout(t, lookup).keep;
      if (s.keepX - s.x0 !== kl.x || s.keepY - s.y0 !== kl.y) turned++;
      let keeps = 0;
      for (let y = s.y0; y <= s.y1; y++) for (let x = s.x0; x <= s.x1; x++) if (state.tiles[y * state.WORLD_TILES_X + x] === TileType.SiteKeep) keeps++;
      if (keeps !== 1) oneKeep = false;
    }
  }
  result(oneKeep, "D every world-gen settlement is templated with exactly one keep");
  result(tiers.has(1) && tiers.has(2) && tiers.has(3), `D tiers on 256 maps: ${[...tiers].sort().join(",")}`);
  result(turned > 0, `D world-gen turns / mirrors settlements (${turned} of the human sites' keeps off their template's spot)`);
  const g2 = gen(12345);
  const saved = JSON.parse(JSON.stringify(sitesForSave()));
  restoreSites(saved);
  const back = Array.from(sites.values()).filter((s) => s.faction === "human");
  result(back.length === g2.human.length && back.every((s) => s.layout && s.homes && s.homes.villagers.length > 0), "D layout + homes survive a save round trip");

  // ---- E ----
  {
    const { handleCreativeSet } = await import("./src/creative.ts");
    gen(4242);
    state.cycleTick = Math.floor(DAY_TICKS / 2);
    const player = { id: "p", clan: 0, dead: false, x: 0, y: 0, socket: { readyState: 1, OPEN: 1, send() {} } };
    const call = (msg) => {
      let out = null;
      handleCreativeSet(player, msg, (ok, text, data = {}) => (out = { ok, text, ...data }));
      return out;
    };
    const list = call({ op: "settlementList" });
    result(list.ok && list.templates.length === builtins.length && list.buildings.length >= 40, `E settlementList: ${list.templates.length} + ${list.buildings.length} building templates`);
    const draft = { ...ham, id: "editor-hamlet", name: "Editor hamlet", builtin: undefined, weight: 0 };
    const badSave = call({ op: "settlementSave", template: { ...draft, rows: draft.rows.map((r) => r.replace("K", ".")) } });
    const ok = call({ op: "settlementSave", template: draft });
    result(!badSave.ok && ok.ok && ok.templates.some((t) => t.id === "editor-hamlet"), `E settlementSave refuses no keep, saves a valid one (${badSave.text})`);
    const W2 = state.WORLD_TILES_X;
    let at = null;
    const hw = draft.rows[0].length;
    const hh = draft.rows.length;
    const { siteFitProblem } = await import("./src/sites.ts");
    for (let y = 30; y < W2 - 30 && !at; y += 7) for (let x = 30; x < W2 - 30 && !at; x += 7) if (!siteFitProblem(draft, x - (hw >> 1), y - (hh >> 1), true)) at = { x, y };
    const before = sites.size;
    const st = at && call({ op: "settlementStamp", id: "editor-hamlet", x: at.x * 32 + 16, y: at.y * 32 + 16 });
    const s = st?.siteId && sites.get(st.siteId);
    result(!!st?.ok && sites.size === before + 1 && s?.faction === "human" && s.layout === "editor-hamlet", `E settlementStamp (${st?.text})`);
    const again = at && call({ op: "settlementStamp", id: "editor-hamlet", x: at.x * 32 + 16, y: at.y * 32 + 16 });
    result(!!again && !again.ok, `E stamping on top is refused (${again?.text})`);
    const delB = call({ op: "settlementDelete", id: ham.id });
    const del = call({ op: "settlementDelete", id: "editor-hamlet" });
    result(!delB.ok && del.ok, "E settlementDelete: built-in refused, user template deleted");
  }

  console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
}
