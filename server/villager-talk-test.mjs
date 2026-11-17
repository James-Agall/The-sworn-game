// Villager conversation test (no server boot, no ports): re-runs itself under tsx and drives the server modules in-process
// with a scratch COLONY_SAVE_DIR. Run from server/: `node villager-talk-test.mjs`.
//   P the pure picker (shared/src/villagerTalk.ts): 12 trades, every token present, no unfilled {placeholders}, gossip names a
//     neighbour and changes with the day, weather / night / season change the sky line, a lone villager has no gossip names.
//   D the dialogue tree: every `next` of the villager role points at a real node; the hub has work / place / gossip / weather;
//     hostile folk are refused, wary folk get a shorter menu.
//   T a real stamped settlement: a villager talks, every branch of the tree is walked, no "{token}" survives in any text,
//     the amenities line names the settlement's real buildings, two different villagers can have different trades, and the
//     same villager keeps its trade across days while the gossip changes.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));

if (process.env.VILLAGER_TEST_INNER !== "1") {
  const TSX = [path.join(DIR, "node_modules/.bin/tsx"), path.join(DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
  const scratch = mkdtempSync(path.join(tmpdir(), "villager-talk-"));
  const child = spawn(TSX, [fileURLToPath(import.meta.url)], {
    cwd: DIR,
    stdio: "inherit",
    env: {
      ...process.env, VILLAGER_TEST_INNER: "1", COLONY_SAVE_DIR: path.join(scratch, "saves"), COLONY_TEST_HOOKS: "1",
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
  const VT = await import("@colony/shared/villagerTalk");
  const { DIALOGUE } = await import("@colony/shared/herolife");
  const { TileType } = await import("@colony/shared/protocol");

  // ---- P ---- the pure picker.
  const base = { seed: 7, day: 3, night: false, weather: "clear", season: 1, tier: 2, neighbours: ["Alda", "Bram", "Cora"], amenities: ["tavern", "church", "mill"], elder: "Elder Dunn" };
  result(VT.VILLAGER_TRADES.length >= 12, `P ${VT.VILLAGER_TRADES.length} trades`);
  const KEYS = ["trade", "hello", "work", "craft", "worry", "past", "sky", "gossip", "place", "amenities", "elderline"];
  let missing = 0, braces = 0;
  for (let seed = 0; seed < VT.VILLAGER_TRADES.length * 2; seed++) {
    for (const weather of ["clear", "rain", "storm", "snow", "fog"]) {
      for (const night of [false, true]) {
        const tk = VT.villagerTokens({ ...base, seed, weather, night, day: seed });
        for (const k of KEYS) if (!tk[k]) missing++;
        // only {npc}/{site}/{trade} may remain, the server fills them last
        for (const v of Object.values(tk)) if (/\{(?!npc\}|site\}|trade\})/.test(v)) braces++;
      }
    }
  }
  result(missing === 0 && braces === 0, `P every token set for every trade x weather x night (${missing} missing, ${braces} stray braces)`);
  const g0 = VT.villagerTokens(base).gossip, g1 = VT.villagerTokens({ ...base, day: 4 }).gossip;
  result(/Alda|Bram|Cora/.test(g0) && g0 !== g1, "P gossip names a neighbour and changes with the day");
  result(VT.villagerTokens({ ...base, neighbours: [] }).gossip.length > 10 && !/\{a\}|\{b\}/.test(VT.villagerTokens({ ...base, neighbours: [] }).gossip), "P a lone villager gets a plain line, no empty names");
  const sky = (w, night) => VT.villagerTokens({ ...base, weather: w, night }).sky;
  result(sky("storm", false) !== sky("clear", false) && sky("clear", true) !== sky("clear", false) && /dark|night|indoors/i.test(sky("clear", true)), "P weather and night change the sky line");
  result(VT.villagerTokens({ ...base, seed: 3, day: 0, season: 3 }).sky.includes("Winter") || VT.villagerTokens({ ...base, seed: 3, day: 1, season: 3 }).sky.includes("Winter") || VT.villagerTokens({ ...base, seed: 3, day: 2, season: 3 }).sky.includes("Winter"), "P the season sometimes joins the weather remark");
  result(VT.amenityList(["tavern", "church", "mill"]) === "the tavern, the chapel and the mill" && VT.amenityList([]).length > 5, `P amenities read naturally: "${VT.amenityList(["tavern", "church", "mill"])}"`);
  const t3 = [3, 4, 5, 6].map((s) => VT.villagerTrade(s).id);
  result(new Set(t3).size === 4, `P neighbouring seeds get different trades (${t3.join(", ")})`);

  // ---- D ---- the dialogue tree.
  const tree = DIALOGUE.villager;
  const dangling = [];
  for (const [id, node] of Object.entries(tree)) for (const c of node.choices) if (c.next && !tree[c.next]) dangling.push(`${id} -> ${c.next}`);
  result(dangling.length === 0, `D every villager choice leads somewhere${dangling.length ? ": " + dangling.join(", ") : ""}`);
  const hub = tree.start.choices.map((c) => c.label).join(" | ");
  result(/work/.test(hub) && /Tell me about/.test(hub) && /gossip/.test(hub) && /weather/.test(hub), `D hub offers work / the place / gossip / the weather (${hub})`);
  const wary = tree.start.choices.filter((c) => !c.tiers || c.tiers.includes("wary")).length, friendly = tree.start.choices.filter((c) => !c.tiers || c.tiers.includes("friendly")).length;
  result(wary < friendly && friendly >= 6, `D a wary villager offers fewer topics than a friend (${wary} vs ${friendly})`);
  result(tree.start.choices.filter((c) => !c.tiers || c.tiers.includes("hostile")).length === 1, "D hostile folk only let you leave");
  const reach = new Set(["start"]);
  for (let pass = 0; pass < 8; pass++) for (const id of [...reach]) for (const c of tree[id].choices) if (c.next) reach.add(c.next);
  result(reach.size === Object.keys(tree).length, `D every node is reachable from the hub (${reach.size}/${Object.keys(tree).length})`);

  // ---- T ---- a real stamped settlement.
  const HL = await import("./src/herolife.ts");
  const bt = await import("./src/buildingTemplates.ts");
  const stt = await import("./src/settlementTemplates.ts");
  const { state, mobs, hearths, gates } = await import("./src/state.ts");
  const { markTileRegistryStale } = await import("./src/chunks.ts");
  const { clearSites, spawnSiteWorkers } = await import("./src/sites.ts");
  const { clearOwners } = await import("./src/tiles.ts");
  bt.loadBuildingTemplates();
  stt.loadSettlementTemplates();
  state.tiles.fill(TileType.Empty);
  markTileRegistryStale();
  mobs.clear(); hearths.clear(); clearOwners(); clearSites(); gates.clear();
  const tpl = stt.settlementTemplateById("village-street");
  const s = stt.stampSettlement(tpl, 20, 20);
  s.awake = true; s.sighted = true;
  spawnSiteWorkers(s);
  const folk = s.workers.map((id) => mobs.get(id)).filter((m) => m && m.siteWorker && m.siteWorker !== "herald" && m.siteWorker !== "priest" && s.workers[0] !== m.id);
  result(folk.length >= 2, `T the stamped village has ${folk.length} ordinary villagers`);
  const sent = [];
  const mk = () => ({ id: "vp", profileKey: "vp", clan: 0, dead: false, hp: 100, x: folk[0].x, y: folk[0].y, socket: { readyState: 1, OPEN: 1, send: (m) => sent.push(JSON.parse(m)) } });
  const player = mk();
  const last = () => sent.filter((m) => m.type === "dialogue" && m.dialogue).at(-1)?.dialogue;
  // Relation: make the settlement neutral-friendly so the whole menu shows.
  const SI = await import("./src/sites.ts");
  const setRel = (v) => SI.adjustRelation(0, s.id, v - SI.relationOf(0, s.id));
  setRel(40);
  const texts = [];
  const open = (m) => { HL.startTalk(player, { role: "villager", name: "Tam", d: 0, site: s, mob: m }); return last(); };
  const d0 = open(folk[0]);
  texts.push(d0.text);
  result(!!d0 && d0.npc.role === "villager" && d0.choices.length >= 4, `T the villager greets: "${d0?.text.slice(0, 70)}..." (${d0?.choices.length} options)`);
  // ---- M ---- villager memory: the greeting mentions the most notable remembered deed.
  const DP = await import("./src/diplomacy.ts");
  const remembered = (t) => /forgotten|did right by us|Word got round|talk about the job|drive those raiders|stood between|fewer of us left|coin's been good|known at the stalls|raised a hand|Last time you came/.test(t);
  const dd = () => (s.diplo ??= {}, s.diplo[0] ??= { day: 0, bought: {}, sold: {}, tradeGain: 0, defendGain: 0, lastGainDay: 0 }, s.diplo[0]);
  delete dd().deeds;
  result(!remembered(open(folk[0]).text), "M a stranger's greeting carries no remembered deed");
  DP.noteDeed(s, 0, "traded"); DP.noteDeed(s, 0, "traded");
  result(!remembered(open(folk[0]).text), "M two purchases are not worth mentioning");
  DP.noteDeed(s, 0, "traded");
  result(/coin's been good|known at the stalls/.test(open(folk[0]).text), "M three trades: the greeting mentions your custom");
  DP.noteDeed(s, 0, "defended"); DP.noteDeed(s, 0, "defended"); DP.noteDeed(s, 0, "defended");
  result(/drive those raiders|stood between|fewer of us left/.test(open(folk[0]).text), "M defending the walls outranks trade");
  DP.noteDeed(s, 0, "quests");
  result(/did right by us|Word got round|talk about the job/.test(open(folk[0]).text), "M a finished quest outranks defence");
  delete dd().deeds;
  DP.noteDeed(s, 0, "attacked");
  result(/raised a hand|Last time you came/.test(open(folk[0]).text), "M an old attack with nothing to balance it is remembered");
  DP.noteDeed(s, 0, "quests");
  result(/did right by us|Word got round|talk about the job/.test(open(folk[0]).text), "M a quest done since is remembered over the old attack");
  result(!/\{[a-z]+\}/.test(open(folk[0]).text), "M the remembered line has no unfilled token");
  // gainRelation records the deed itself.
  delete dd().deeds;
  setRel(40);
  DP.gainRelation(0, s, 1, "quest");
  result((dd().deeds?.quests ?? 0) === 1, `M gainRelation('quest') records a quest deed (${JSON.stringify(dd().deeds)})`);
  delete dd().deeds;
  // The same real-place rumour the tavern patrons tell: a villager on speaking terms knows of trouble nearby.
  {
    const hubR = open(folk[0]);
    const i = hubR.choices.findIndex((c) => /trouble on the roads/.test(c.label));
    result(i >= 0, `T the hub offers "Any trouble on the roads?" (${hubR.choices.map((c) => c.label.slice(0, 18)).join(" / ")})`);
    if (i >= 0) {
      HL.handleDialogueChoice(player, i);
      const rr = last();
      result(rr.text.length > 10 && !/\{[a-z]+\}/.test(rr.text), `T the villager answers with a rumour: ${rr.text.replace(/\n/g, " ").slice(0, 100)}`);
    }
  }
  // walk every topic from the hub
  const labelsSeen = new Set();
  for (const topic of ["How is the work", "Tell me about", "Heard any gossip", "make of the weather", "about yourself"]) {
    const hubNow = open(folk[0]);
    const i = hubNow.choices.findIndex((c) => c.label.includes(topic));
    if (i < 0) { result(false, `T hub option "${topic}" missing (${hubNow.choices.map((c) => c.label).join(" / ")})`); continue; }
    HL.handleDialogueChoice(player, i);
    const d = last();
    texts.push(d.text);
    d.choices.forEach((c) => labelsSeen.add(c.label));
    // and one follow-up level
    const j = d.choices.findIndex((c) => c.label !== "Farewell." && !/else|Let's talk|Thanks|Interesting|Thank you/.test(c.label) && !c.disabled);
    if (j >= 0) { HL.handleDialogueChoice(player, j); texts.push(last().text); }
  }
  const stray = texts.filter((t) => /\{[a-z]+\}/.test(t));
  result(stray.length === 0, `T no unfilled {token} in ${texts.length} lines${stray.length ? ": " + stray[0].slice(0, 80) : ""}`);
  result(new Set(texts).size === texts.length, `T every topic answered differently (${new Set(texts).size}/${texts.length} distinct)`);
  // the amenities answer names the real buildings
  const hub2 = open(folk[0]);
  HL.handleDialogueChoice(player, hub2.choices.findIndex((c) => c.label.includes("Tell me about")));
  const place = last();
  HL.handleDialogueChoice(player, place.choices.findIndex((c) => /Where can I find/.test(c.label)));
  const am = last().text;
  result(/chapel/.test(am) && /smithy/.test(am) && /mill/.test(am), `T "where can I find things" names the village's buildings: ${am.replace(/\n/g, " ").slice(0, 110)}`);
  // villagers differ; one keeps its trade across days; gossip rotates
  const trades = new Set(folk.map((m) => { const d = open(m); return d.text.match(/(farmer|shepherd|woodcutter|miller|weaver|mason|herbalist|beekeeper|cooper|potter|hunter|baker)/)?.[1] ?? "?"; }));
  result(trades.size >= 2 || folk.length < 3, `T different villagers have different trades (${[...trades].join(", ")})`);
  const tradeOf = (m) => { HL.startTalk(player, { role: "villager", name: "Tam", d: 0, site: s, mob: m }); const t = last().text; return t.match(/(farmer|shepherd|woodcutter|miller|weaver|mason|herbalist|beekeeper|cooper|potter|hunter|baker)/)?.[1]; };
  const day1 = tradeOf(folk[0]);
  state.cycleTick += 5 * (await import("./src/constants.ts")).GAME_DAY_TICKS;
  const day2 = tradeOf(folk[0]);
  result(day1 && day1 === day2, `T a villager keeps its trade across days (${day1} -> ${day2})`);
  const gossipOn = () => { const h = open(folk[0]); HL.handleDialogueChoice(player, h.choices.findIndex((c) => /gossip/.test(c.label))); return last().text; };
  const gs = new Set(); for (let k = 0; k < 6; k++) { gs.add(gossipOn()); state.cycleTick += (await import("./src/constants.ts")).GAME_DAY_TICKS; }
  result(gs.size >= 4, `T gossip changes from day to day (${gs.size} different lines over 6 days)`);
  // a hostile relation: the villager backs away
  setRel(-80);
  const dh = open(folk[0]);
  result(/backs away/.test(dh.text) && dh.choices.length === 1, `T a hostile settlement's villager backs away (${dh.choices.map((c) => c.label).join(" / ")})`);

  console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
}
