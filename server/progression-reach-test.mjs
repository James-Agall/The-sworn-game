// Progression reachability audit (no server boot, no ports): re-runs itself under tsx and walks shared/src/progression.ts
// PROGRESSION from nothing (the starter kit only) to a fixed point. Run from server/: `node progression-reach-test.mjs`.
// Sources besides the recipes: the hero gathers wood and rock by hand and farms (grain, hay, hops, hemp / cotton) from day
// one; hunting / animal products come from their buildings (Hunter's Hut: meat, hide; Chicken Coop: eggs; Livestock Barn:
// milk; Sheep Pen / Wool Farm: wool; any animal house: manure; Forager's Hut / Orchard: fruit, herbs); a Mine's layer L
// yields MINE_LAYER_YIELDS[L - 1] once the Mine reaches level L (mine encounters: bones, gems); the Tailor weaves cloth
// from wool + hemp, the Blacksmith makes tools from iron (constants.ts CRAFT_RECIPES).
//   R every item, every gated building (with its every gated level), every recipe station level and every Progression
//     chain step is reachable; an unreachable one is reported with its unmet gates, and a cycle among the unreachable
//     gates is printed as such.
//   O the bronze-first order: Quarry -> Mine L1 -> Bloomery -> bronze -> Blacksmith -> bronze pickaxe -> Mine L2 -> iron
//     -> iron bloom -> iron pickaxe -> Mine L3 (each strictly after the one before).
//   N the Bloomery, bronze, the anvil / hammer & tongs and the Blacksmith (gates and build costs) are reachable with NO
//     iron at all (not even the starting stock) and NO hide.
//   F the retired Foundry is referenced nowhere (no recipe, gate or chain) and leaves no item without a source.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));

if (process.env.REACH_TEST_INNER !== "1") {
  const TSX = [path.join(DIR, "node_modules/.bin/tsx"), path.join(DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
  const scratch = mkdtempSync(path.join(tmpdir(), "progression-reach-"));
  const child = spawn(TSX, [fileURLToPath(import.meta.url)], {
    cwd: DIR,
    stdio: "inherit",
    env: { ...process.env, REACH_TEST_INNER: "1", COLONY_SAVE_DIR: path.join(scratch, "saves") },
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
  const { PROGRESSION, PROGRESSION_BUILDING_LABEL } = await import("@colony/shared/progression");
  const { MINE_LAYER_YIELDS, MINE_LAYERS } = await import("@colony/shared/mines");
  const { BUILD_COSTS } = await import("@colony/shared/buildings");
  const T = TileType;
  const MAX_LEVEL = 3;
  const RETIRED = new Set([T.Foundry]);
  const label = (tile) => PROGRESSION_BUILDING_LABEL[tile] ?? T[tile] ?? String(tile);

  // ---- the walk ----
  // `banned`: stock keys / items that never appear (the N check). Returns the round each node became reachable:
  // "item:<id>", "stock:<key>", "b:<tile>:<level>".
  function walk(banned = new Set()) {
    // Rounds are breadth-first: a pass reads only what earlier passes reached (its own finds land at its end).
    const round = new Map();
    let r = 0;
    const has = (k) => round.has(k);
    let pending = new Set();
    const add = (k) => {
      if (!has(k) && !banned.has(k)) pending.add(k);
    };
    const lvl = (tile) => {
      let best = 0;
      for (let L = 1; L <= MAX_LEVEL; L++) if (has(`b:${tile}:${L}`)) best = L;
      return best;
    };
    const reqMet = (req) => {
      if (!req) return true;
      for (const [id, n] of Object.entries(req.items ?? {})) if (n > 0 && !has(`item:${id}`)) return false;
      for (const b of req.buildings ?? []) if (lvl(b.tile) < (b.level ?? 1)) return false;
      return true;
    };
    for (const [id, n] of Object.entries(PROGRESSION.starterKit)) if (n > 0) round.set(`item:${id}`, 0);
    for (;;) {
      pending = new Set();
      // Base sources: hand gathering and the hero's farming (hoe, can and seeds in the kit).
      for (const k of ["stock:wood", "stock:rock", "stock:grain", "stock:cotton", "item:hay", "item:hops"]) add(k);
      // Buildings: ungated ones (every tile any gate / chain / recipe names) are open; gated ones by their rows.
      const tiles = new Set();
      for (const t of Object.keys(PROGRESSION.buildings)) tiles.add(Number(t));
      for (const c of PROGRESSION.chains) for (const st of c.steps) if (st.building !== undefined) tiles.add(st.building);
      for (const rc of PROGRESSION.recipes) if (rc.station !== "hand") tiles.add(rc.station);
      for (const row of Object.values(PROGRESSION.buildings)) for (const b of [...(row.requires?.buildings ?? []), ...Object.values(row.levels ?? {}).flatMap((q) => q.buildings ?? [])]) tiles.add(b.tile);
      for (const t of [T.HunterHut, T.ChickenCoop, T.LivestockBarn, T.PigSty, T.SheepPen, T.WoolFarm, T.ForagerHut, T.Orchard, T.TailorShop]) tiles.add(t);
      for (const tile of tiles) {
        if (RETIRED.has(tile)) continue;
        const row = PROGRESSION.buildings[tile];
        // Its build cost's resources too (the Blacksmith's must not need iron: it comes before any iron ore).
        const costOk = Object.entries(BUILD_COSTS[tile] ?? {}).every(([k, n]) => !(n > 0) || has(`stock:${k}`));
        if (!has(`b:${tile}:1`) && costOk && reqMet(row?.requires)) add(`b:${tile}:1`);
        for (let L = 2; L <= MAX_LEVEL; L++) if (has(`b:${tile}:${L - 1}`) && !has(`b:${tile}:${L}`) && reqMet(row?.levels?.[L])) add(`b:${tile}:${L}`);
      }
      // Hunting / animals / foraging.
      const built = (tile) => lvl(tile) >= 1;
      if (built(T.HunterHut)) for (const k of ["stock:meat", "item:hide"]) add(k);
      if (built(T.ChickenCoop)) add("item:egg");
      if (built(T.LivestockBarn)) add("item:milk");
      if (built(T.SheepPen) || built(T.WoolFarm)) add("stock:wool");
      if ([T.ChickenCoop, T.LivestockBarn, T.PigSty, T.SheepPen].some(built)) add("item:manure");
      if (built(T.ForagerHut) || built(T.Orchard)) for (const k of ["stock:fruit", "item:herbs"]) add(k);
      // The old artisan crafts (constants.ts CRAFT_RECIPES): cloth at the Tailor, tools at the Blacksmith.
      if (built(T.TailorShop) && has("stock:wool") && has("stock:cotton")) add("stock:clothes");
      if (built(T.Blacksmith) && has("stock:iron")) add("stock:tools");
      // The Mine's layers; any mine's encounters.
      for (let L = 1; L <= MINE_LAYERS; L++) if (lvl(T.IronMinePost) >= L) for (const y of MINE_LAYER_YIELDS[L - 1]) add(y.res === "iron" ? "stock:iron" : `item:${y.res}`);
      if (built(T.IronMinePost) || lvl(T.RockMinePost) >= 2) for (const k of ["item:bones", "item:gems"]) add(k);
      // Recipes.
      for (const rc of PROGRESSION.recipes) {
        if (rc.station !== "hand" && lvl(rc.station) < (rc.stationLevel ?? 1)) continue;
        const ins = [
          ...Object.entries(rc.stock ?? {}).map(([k, n]) => [`stock:${k}`, n]),
          ...Object.entries({ ...(rc.items ?? {}), ...(rc.needs ?? {}) }).map(([k, n]) => [`item:${k}`, n]),
        ];
        if (ins.every(([k, n]) => !(n > 0) || has(k))) add(`item:${rc.output}`);
      }
      if (pending.size === 0) break;
      r++;
      for (const k of pending) round.set(k, r);
    }
    return { round, lvl };
  }

  // Unmet gates of a building level / item (for the report), and a cycle among unreachable nodes.
  function gatesOf(key) {
    const [kind, a, b] = key.split(":");
    if (kind === "b") {
      const tile = Number(a);
      const L = Number(b);
      const row = PROGRESSION.buildings[tile];
      const req = L === 1 ? row?.requires : row?.levels?.[L];
      const out = [...Object.keys(req?.items ?? {}).map((i) => `item:${i}`), ...(req?.buildings ?? []).map((x) => `b:${x.tile}:${x.level ?? 1}`)];
      if (L === 1) out.push(...Object.keys(BUILD_COSTS[tile] ?? {}).map((k) => `stock:${k}`));
      if (L > 1) out.push(`b:${tile}:${L - 1}`);
      return [out];
    }
    if (kind === "item") {
      return PROGRESSION.recipes.filter((rc) => rc.output === a).map((rc) => [
        ...Object.keys(rc.stock ?? {}).map((k) => `stock:${k}`),
        ...Object.keys({ ...(rc.items ?? {}), ...(rc.needs ?? {}) }).map((k) => `item:${k}`),
        ...(rc.station === "hand" ? [] : [`b:${rc.station}:${rc.stationLevel ?? 1}`]),
      ]);
    }
    return [];
  }
  const nice = (k) => {
    const [kind, a, b] = k.split(":");
    return kind === "b" ? `${label(Number(a))} L${b}` : kind === "item" ? (PROGRESSION.items[a]?.label ?? a) : `${a} (stock)`;
  };
  function findCycle(unreached) {
    const set = new Set(unreached);
    const color = new Map();
    const stack = [];
    let found = null;
    const dfs = (k) => {
      if (found) return;
      color.set(k, 1);
      stack.push(k);
      for (const alt of gatesOf(k)) for (const d of alt) {
        if (!set.has(d) || found) continue;
        if (color.get(d) === 1) found = [...stack.slice(stack.indexOf(d)), d];
        else if (!color.has(d)) dfs(d);
      }
      stack.pop();
      color.set(k, 2);
    };
    for (const k of set) if (!color.has(k) && !found) dfs(k);
    return found;
  }

  // ---- R ----
  const { round, lvl } = walk();
  const unreached = [];
  for (const id of Object.keys(PROGRESSION.items)) if (!round.has(`item:${id}`)) unreached.push(`item:${id}`);
  for (const [t, row] of Object.entries(PROGRESSION.buildings)) {
    if (!round.has(`b:${t}:1`)) unreached.push(`b:${t}:1`);
    for (const L of Object.keys(row.levels ?? {})) if (!round.has(`b:${t}:${L}`)) unreached.push(`b:${t}:${L}`);
  }
  for (const rc of PROGRESSION.recipes) if (rc.station !== "hand" && lvl(rc.station) < (rc.stationLevel ?? 1)) unreached.push(`b:${rc.station}:${rc.stationLevel ?? 1}`);
  for (const c of PROGRESSION.chains) for (const st of c.steps) {
    const k = st.building !== undefined ? `b:${st.building}:1` : `item:${st.item}`;
    if (!round.has(k)) unreached.push(k);
  }
  const uniq = [...new Set(unreached)];
  for (const k of uniq) {
    const why = gatesOf(k).map((alt) => alt.filter((d) => !round.has(d)).map(nice).join(" + ") || "(no source)").join(" | ");
    console.log(`  unreachable ${nice(k)}: needs ${why || "(no recipe or source)"}`);
  }
  const cycle = uniq.length ? findCycle(uniq) : null;
  if (cycle) console.log(`  cyclic gate: ${cycle.map(nice).join(" -> ")}`);
  result(uniq.length === 0, `R ${Object.keys(PROGRESSION.items).length} items, ${Object.keys(PROGRESSION.buildings).length} gated buildings (all levels), every recipe station and chain step reachable from the starter kit in ${Math.max(...round.values()) + 1} rounds${uniq.length ? `; ${uniq.length} unreachable${cycle ? " (cycle)" : ""}` : ""}`);
  result(lvl(T.IronMinePost) === MINE_LAYERS && lvl(T.RockMinePost) === MAX_LEVEL, `R every mine level: Mine L${lvl(T.IronMinePost)}/${MINE_LAYERS}, Quarry L${lvl(T.RockMinePost)}`);

  // ---- O ----
  const order = [
    ["b", T.RockMinePost, 1], ["b", T.IronMinePost, 1], ["b", T.Bloomery, 1], ["item", "bronze"], ["b", T.Blacksmith, 1],
    ["item", "bronzePick"], ["b", T.IronMinePost, 2], ["stock", "iron"], ["item", "ironBloom"], ["item", "ironPick"], ["b", T.IronMinePost, 3],
  ].map(([kind, a, b]) => (kind === "b" ? `b:${a}:${b}` : `${kind}:${a}`));
  const rounds = order.map((k) => round.get(k));
  const ordered = rounds.every((x, i) => x !== undefined && (i === 0 || x > rounds[i - 1]));
  result(ordered, `O ${order.map((k, i) => `${nice(k)}@${rounds[i]}`).join(" -> ")}`);

  // ---- N ----
  const noIron = walk(new Set(["stock:iron", "item:hide", "item:ironBloom", "stock:tools"]));
  const nIron = ["b:" + T.Bloomery + ":1", "item:bronze", "item:anvil", "item:smithTools", "b:" + T.Blacksmith + ":1", "item:bronzePick", "item:bronzeTools", "item:bellows", "b:" + T.IronMinePost + ":2"];
  const missing = nIron.filter((k) => !noIron.round.has(k));
  result(missing.length === 0, `N with no iron, iron blooms, tools or hide: ${nIron.map(nice).join(", ")} reachable${missing.length ? `; missing ${missing.map(nice).join(", ")}` : ""}`);
  const bl = PROGRESSION.buildings[T.Bloomery]?.requires ?? {};
  result(!(bl.buildings ?? []).some((b) => b.tile === T.Blacksmith) && !Object.keys(bl.items ?? {}).some((i) => i === "ironBloom" || i === "hide"),
    `N the Bloomery's level 1 needs ${JSON.stringify(bl)} (no Blacksmith, iron or hide)`);
  const bellows = PROGRESSION.recipes.find((rc) => rc.id === "bellows");
  result(!!bellows && !bellows.items?.hide && !bellows.needs?.hide, `N bellows: ${JSON.stringify({ stock: bellows?.stock, items: bellows?.items })}`);

  // ---- F ----
  const foundryRefs = [
    ...PROGRESSION.recipes.filter((rc) => RETIRED.has(rc.station)).map((rc) => `recipe ${rc.id}`),
    ...Object.entries(PROGRESSION.buildings).filter(([t, row]) => RETIRED.has(Number(t)) || [...(row.requires?.buildings ?? []), ...Object.values(row.levels ?? {}).flatMap((q) => q.buildings ?? [])].some((b) => RETIRED.has(b.tile))).map(([t]) => `gate of ${label(Number(t))}`),
    ...PROGRESSION.chains.flatMap((c) => c.steps.filter((st) => RETIRED.has(st.building)).map(() => `chain ${c.id}`)),
  ];
  result(foundryRefs.length === 0, `F the retired Foundry is referenced nowhere${foundryRefs.length ? `: ${foundryRefs.join(", ")}` : ""}`);
  const metals = ["bronze", "lead", "ironBloom", "anvil", "smithTools", "bronzeTools", "steel"];
  const atBloomery = metals.filter((id) => PROGRESSION.recipes.some((rc) => rc.output === id && rc.station === T.Bloomery));
  result(atBloomery.length === metals.length && PROGRESSION.recipes.some((rc) => rc.output === "goldDust" && rc.station === T.Bloomery),
    `F the Bloomery smelts / casts ${atBloomery.join(", ")} and gold dust`);

  console.log(fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`);
  process.exit(fails === 0 ? 0 : 1);
}
