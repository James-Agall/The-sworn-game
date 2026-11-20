// Inn test (ROADMAP-NEXT Step 2.5: buy a rumour / rest at the inn). In-process, no ports. Run from server/: `node inn-test.mjs`.
//   A tavern keeper's dialogue offers Buy a rumour (10 gold) and Rest at the inn (5 gold); a rumour costs exactly the price and
//   reveals a previously unexplored place; buying again reveals a different one; rest restores rest/energy; too little
//   gold is refused with no state change.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));

if (process.env.INN_TEST_INNER !== "1") {
  const TSX = [path.join(DIR, "node_modules/.bin/tsx"), path.join(DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
  const scratch = mkdtempSync(path.join(tmpdir(), "inn-"));
  const child = spawn(TSX, [fileURLToPath(import.meta.url)], {
    cwd: DIR,
    stdio: "inherit",
    env: {
      ...process.env, INN_TEST_INNER: "1", COLONY_SAVE_DIR: path.join(scratch, "saves"), COLONY_TEST_HOOKS: "1",
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
  const { DIALOGUE } = await import("@colony/shared/herolife");
  const { TileType } = await import("@colony/shared/protocol");

  const HL = await import("./src/herolife.ts");
  const Q = await import("./src/quests.ts");
  const bt = await import("./src/buildingTemplates.ts");
  const stt = await import("./src/settlementTemplates.ts");
  const { state, mobs, hearths, gates, players } = await import("./src/state.ts");
  const { markTileRegistryStale } = await import("./src/chunks.ts");
  const SI = await import("./src/sites.ts");
  const { clearOwners, tileIndex } = await import("./src/tiles.ts");
  const { GAME_DAY_TICKS } = await import("./src/constants.ts");
  bt.loadBuildingTemplates();
  stt.loadSettlementTemplates();
  state.tiles.fill(TileType.Empty);
  markTileRegistryStale();
  mobs.clear(); hearths.clear(); clearOwners(); SI.clearSites(); gates.clear();
  const s = stt.stampSettlement(stt.settlementTemplateById("village-street"), 20, 20);
  s.awake = true; s.sighted = true;
  SI.spawnSiteWorkers(s);
  SI.adjustRelation(0, s.id, 40 - SI.relationOf(0, s.id));
  state.cycleTick = 2 * GAME_DAY_TICKS + 100; // morning, past any cooldown
  const sent = [];
  const player = { id: "nr", profileKey: "nr", clan: 0, dead: false, hp: 100, maxHp: 100, x: (s.keepX + 0.5) * 32, y: (s.keepY + 1.5) * 32, socket: { readyState: 1, OPEN: 1, send: (m) => sent.push(JSON.parse(m)) } };
  players.set(player.id, player);
  const last = () => sent.filter((m) => m.type === "dialogue" && m.dialogue).at(-1)?.dialogue;
  const talk = (role, name, mob) => { HL.startTalk(player, { role, name, d: 0, site: s, mob }); return last(); };
  const choose = (d, re) => {
    const i = d.choices.findIndex((c) => re.test(c.label));
    if (i < 0) return null;
    HL.handleDialogueChoice(player, i);
    return last();
  };
  const at = (m) => { player.x = m ? m.x : (s.keepX + 0.5) * 32; player.y = m ? m.y : (s.keepY + 1.5) * 32; };

  const talkInn = () => { HL.startTalk(player, { role: "keeper", name: "Innkeeper", d: 0, site: s, inside: { world: true, key: "tav", x: player.x, y: player.y, anchor: { x: 0, y: 0 }, tavern: true } }); return last(); };
  const gold = () => state.stock.gold ?? 0;
  const labels = talkInn().choices.map((c) => c.label);
  result(labels.some((l) => /Buy a rumour \(10 gold\)/.test(l)) && labels.some((l) => /Rest at the inn \(5 gold\)/.test(l)), `inn choices: ${labels.join(" / ")}`);
  // Two ore seams far apart are the only places on offer (the village stamp brought a camp hearth).
  hearths.clear();
  const W = state.WORLD_TILES_X;
  const seams = [[100, 100], [130, 40]];
  for (const [x, y] of seams) state.tiles[y * W + x] = TileType.IronOre;
  markTileRegistryStale();
  const seen = ([x, y]) => state.explored[y * W + x] === 1;
  result(seams.every((q) => !seen(q)), "seams unexplored before");
  state.stock.gold = 50;
  let d = talkInn();
  d = choose(d, /Buy a rumour/);
  result(gold() === 40 && /revealed on the minimap/.test(d?.text ?? "") && seams.filter(seen).length === 1, `rumour 1: gold 50 -> ${gold()}, ${seams.filter(seen).length} seam revealed: ${d?.text}`);
  const first = seams.findIndex(seen);
  d = choose(talkInn(), /Buy a rumour/);
  result(gold() === 30 && seams.every(seen) && seams.findIndex((q, i) => i !== first && seen(q)) >= 0, `rumour 2 reveals the other seam, gold ${gold()}`);
  state.stock.gold = 7;
  const life = HL.lifeOf(player);
  d = talkInn();
  const ri = d.choices.find((c) => /Buy a rumour/.test(c.label));
  result(!!ri?.disabled && gold() === 7, `rumour refused at 7 gold (${ri?.disabled})`);
  HL.handleDialogueChoice(player, d.choices.findIndex((c) => /Buy a rumour/.test(c.label)));
  result(gold() === 7 && life.flags.innRumourN === 2, "refused rumour changes no state");
  life.rest = 10; life.energy = 5;
  d = choose(talkInn(), /Rest at the inn/);
  result(gold() === 2 && life.rest > 90 && life.energy > 90, `rest: gold 7 -> ${gold()}, rest ${life.rest}, energy ${life.energy}`);
  d = talkInn();
  const rest = d.choices.find((c) => /Rest at the inn/.test(c.label));
  result(!!rest?.disabled && gold() === 2, `rest refused at 2 gold (${rest?.disabled})`);
  process.exit(fails ? 1 : 0);
}
