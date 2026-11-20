// Named-role test (QUEUE G7 "a real quest-giver role with its own dialogue / quests"; ROADMAP "Named roles — landed").
// No server boot, no ports: re-runs itself under tsx and drives the server modules in-process with a scratch
// COLONY_SAVE_DIR. Run from server/: `node named-roles-test.mjs` (or `npm test -- named-roles`).
//   P the pure data (shared/src/namedRoles.ts): one stable name per settlement and role, the Elder's name unchanged, the
//     goods a role asks for (short ones first, never one already asked), the captain's kinds by day / night; every
//     named-role dialogue tree links up and a hostile one only lets you leave.
//   T a real stamped village (forge, chapel, garrison): the Elder's "Who's who" names the merchant, priest, smith and
//     captain; the merchant / priest outdoors carry their settlement names; an ordinary keeper is not a quest giver.
//   S the smith: asks for iron / wood / stone (his own quest: titled with his name, off the settlement board's cap),
//     no second one while it is open, accept + deliver from the dialogue, his favour (tools, once a day) opens only
//     after the service, the greeting remembers it, his cooldown holds the next ask.
//   C the captain (a guard of the garrison): no camp, nothing to do; a camp near: "clear the camp"; burning it pays;
//     his scouts' report then names the camps.
//   M the "!" marks: over the merchant / priest / captain with work for you, gone while their quest is accepted.
//   I indoors: the forge's keeper is the same smith (name, role) with a "!" while he has work.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));

if (process.env.NAMED_ROLES_TEST_INNER !== "1") {
  const TSX = [path.join(DIR, "node_modules/.bin/tsx"), path.join(DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
  const scratch = mkdtempSync(path.join(tmpdir(), "named-roles-"));
  const child = spawn(TSX, [fileURLToPath(import.meta.url)], {
    cwd: DIR,
    stdio: "inherit",
    env: {
      ...process.env, NAMED_ROLES_TEST_INNER: "1", COLONY_SAVE_DIR: path.join(scratch, "saves"), COLONY_TEST_HOOKS: "1",
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
  const NR = await import("@colony/shared/namedRoles");
  const { DIALOGUE } = await import("@colony/shared/herolife");
  const { TileType } = await import("@colony/shared/protocol");

  // ---- P ---- pure data.
  result(NR.namedRoleName("site-7", "smith") === NR.namedRoleName("site-7", "smith") && /^Smith [A-Z][a-z]+$/.test(NR.namedRoleName("site-7", "smith")), `P a stable name per settlement and role: ${NR.namedRoleName("site-7", "smith")}`);
  result(NR.namedRoleName("site-7", "elder") === `Elder ${NR.nameFor("site-7")}` && NR.namedRoleName("site-7", "priest").startsWith("Brother "), "P the Elder keeps the name it always had; the priest is a Brother");
  const g1 = NR.roleQuestGood("smith", { iron: 50, wood: 3, rock: 80 }, new Set(), 20, 0.9);
  const g2 = NR.roleQuestGood("smith", { iron: 50, wood: 3, rock: 80 }, new Set(["wood"]), 20, 0.0);
  const g3 = NR.roleQuestGood("smith", {}, new Set(["iron", "wood", "rock"]), 20, 0.5);
  result(g1 === "wood" && (g2 === "iron" || g2 === "rock") && g3 === undefined, `P the smith asks for what is short (${g1}), never twice the same (${g2}), nothing when all asked (${g3})`);
  result(NR.roleQuestKinds("captain", false).join() === "clearCamp" && NR.roleQuestKinds("captain", true)[0] === "defend" && NR.roleQuestKinds("smith", true).join() === "deliver", "P the captain asks for a camp by day, the walls held first by night");
  for (const role of ["smith", "captain"]) {
    const tree = DIALOGUE[role];
    const dangling = [];
    for (const [id, node] of Object.entries(tree)) for (const c of node.choices) if (c.next && !tree[c.next]) dangling.push(`${id}->${c.next}`);
    const hostile = tree.start.choices.filter((c) => !c.tiers || c.tiers.includes("hostile")).length;
    const acts = tree.start.choices.map((c) => c.action).filter(Boolean);
    result(dangling.length === 0 && hostile === 1 && acts.includes("roleWork") && acts.includes("rolePerk"), `P the ${role}'s tree links up, has work + favour, hostile only lets you leave (${dangling.join(",")})`);
  }
  for (const role of ["trader", "questGiver"]) result(DIALOGUE[role].start.choices.some((c) => c.action === "roleWork") && DIALOGUE[role].start.choices.some((c) => c.action === "rolePerk"), `P the ${role} tree gains its own work and favour`);
  result(DIALOGUE.leader.start.choices.some((c) => c.action === "whoswho"), "P the Elder answers \"Who's who\"");

  // ---- T ---- a real stamped village.
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

  at(null);
  const elder = talk("leader", NR.namedRoleName(s.id, "elder"));
  const who = choose(elder, /Who's who/);
  const names = ["trader", "priest", "smith", "captain"].map((r) => NR.namedRoleName(s.id, r));
  result(!!who && names.every((n) => who.text.includes(n)), `T the Elder's who's who names ${names.join(", ")}: ${who?.text.replace(/\n/g, " ").slice(0, 160)}`);
  const priestMob = s.workers.map((id) => mobs.get(id)).find((m) => m?.siteWorker === "priest");
  const traderMob = mobs.get(s.workers[0]);
  const near = (m) => { at(m); HL.handleInteract(player); const d = last(); HL.closeTalk(player); return d; };
  const dt = near(traderMob);
  const dp = priestMob ? near(priestMob) : null;
  result(dt?.text.includes(NR.namedRoleName(s.id, "trader")) || /Who do you speak to/.test(dt?.text ?? "") || dt?.npc?.name === NR.namedRoleName(s.id, "trader"), `T the merchant outdoors is ${dt?.npc?.name} (${NR.namedRoleName(s.id, "trader")})`);
  result(!priestMob || dp?.npc?.name === NR.namedRoleName(s.id, "priest") || /Who do you speak to/.test(dp?.text ?? ""), `T the priest outdoors is ${dp?.npc?.name}`);
  const keeper = talk("trader", "Bryn");
  result(!keeper.choices.some((c) => /fetched|put by/.test(c.label)), `T an ordinary keeper is no quest giver (${keeper.choices.map((c) => c.label).join(" / ")})`);

  // ---- S ---- the smith.
  const smithName = NR.namedRoleName(s.id, "smith");
  at(null);
  let d = talk("smith", smithName);
  result(d.npc.roleLabel === "Smith" && d.choices.some((c) => /fetched/.test(c.label)), `S the smith greets: "${d.text.slice(0, 60)}" (${d.choices.map((c) => c.label).join(" / ")})`);
  const perk0 = d.choices.find((c) => /forge me/.test(c.label));
  result(!!perk0?.disabled, `S his favour is shut to a stranger (${perk0?.disabled})`);
  const boardBefore = Q.boardQuestsFor(0, s.id).length;
  d = choose(d, /fetched/);
  const sq = Q.quests.find((q) => q.giver === "smith" && q.siteId === s.id);
  result(!!sq && sq.kind === "deliver" && ["iron", "wood", "rock"].includes(sq.good) && Q.boardQuestsFor(0, s.id).length === boardBefore, `S he asks for ${sq?.qty} ${sq?.good} (his own quest, not on the board)`);
  const snapQ = Q.questsForSnapshot(0).find((q) => q.id === sq?.id);
  result(snapQ?.title.startsWith(`${smithName}:`) && snapQ.giverRole === "smith" && snapQ.giver === smithName, `S titled with his name: "${snapQ?.title}"`);
  d = talk("smith", smithName);
  choose(d, /fetched/);
  result(Q.quests.filter((q) => q.giver === "smith" && q.siteId === s.id).length === 1, "S no second quest while his is open");
  d = choose(last(), /I'll do it/);
  result(sq.accepted && /Thank you/.test(d?.text ?? ""), `S accepted from his dialogue: ${d?.text.slice(0, 50)}`);
  state.stock[sq.good] = 500;
  state.stock.tools = 0;
  d = choose(d, /Deliver/);
  const fav = s.diplo?.[0]?.favour?.smith ?? 0;
  result(!Q.quests.includes(sq) && fav === 1, `S delivered (stock ${state.stock[sq.good]}), favour ${fav}: ${d?.text.replace(/\n/g, " ").slice(0, 80)}`);
  d = talk("smith", smithName);
  result(d.text.includes(NR.ROLE_REMEMBERS.smith), "S his greeting remembers the service");
  const perk1 = d.choices.find((c) => /forge me/.test(c.label));
  result(perk1 && !perk1.disabled, "S his favour is open after the service");
  d = choose(d, /forge me/);
  result(state.stock.tools === NR.SMITH_FAVOUR_TOOLS, `S tools for your stores: ${state.stock.tools} (${d?.text.slice(0, 50)})`);
  d = talk("smith", smithName);
  result(d.choices.find((c) => /forge me/.test(c.label))?.disabled === "Not again today", "S once a game day");
  d = choose(d, /fetched/);
  result(!Q.quests.some((q) => q.giver === "smith" && q.siteId === s.id) && /tomorrow|enough/.test(d?.text ?? ""), `S his cooldown holds the next ask: ${d?.text.slice(0, 60)}`);

  // ---- C ---- the captain.
  const cap = HL.captainOf(s);
  result(!!cap && (cap.kind === "townGuard" || cap.kind === "townKnight"), `C the captain is a ${cap?.kind} of the garrison`);
  const capName = NR.namedRoleName(s.id, "captain");
  at(cap);
  HL.handleInteract(player);
  let dc = last();
  if (/Who do you speak to/.test(dc?.text ?? "")) dc = choose(dc, new RegExp(capName));
  result(dc?.npc?.role === "captain" && dc.npc.name === capName, `C E beside the guard talks to ${dc?.npc?.name} (${dc?.npc?.roleLabel})`);
  dc = choose(dc, /watch need/);
  result(!Q.quests.some((q) => q.giver === "captain") && /No camp/.test(dc?.text ?? ""), `C no camp near: ${dc?.text.slice(0, 60)}`);
  hearths.set("camp-x", { siteId: "camp-x", siteKind: "camp", x: s.keepX + 25, y: s.keepY - 10, hp: 100, maxHp: 100, destroyed: false, faction: "bandit", garrison: 4 });
  const marksBefore = HL.questMarksFor(0);
  result(marksBefore.includes(cap.id) && marksBefore.includes(traderMob.id), `M "!" over the captain and the merchant with work for you (${marksBefore.length} marks)`);
  dc = talk("captain", capName, cap);
  dc = choose(dc, /watch need/);
  const cq = Q.quests.find((q) => q.giver === "captain");
  result(cq?.kind === "clearCamp" && cq.targetId === "camp-x", `C a camp near: "${Q.questsForSnapshot(0).find((q) => q.id === cq?.id)?.title}"`);
  choose(last(), /I'll do it/);
  result(!HL.questMarksFor(0).includes(cap.id), "M the captain's \"!\" goes while his quest is accepted");
  const gold0 = state.stock.gold ?? 0;
  hearths.get("camp-x").destroyed = true;
  Q.noteQuestCampCleared(hearths.get("camp-x"), "p:nr");
  result(!Q.quests.includes(cq) && (state.stock.gold ?? 0) > gold0 && (s.diplo[0].favour.captain ?? 0) === 1, `C the camp burned: paid ${(state.stock.gold ?? 0) - gold0} gold, his favour ${s.diplo[0].favour.captain}`);
  hearths.set("camp-y", { siteId: "camp-y", siteKind: "fort", x: s.keepX - 30, y: s.keepY, hp: 100, maxHp: 100, destroyed: false, faction: "orc", garrison: 6 });
  dc = talk("captain", capName, cap);
  dc = choose(dc, /scouts/);
  result(/count 1 camp/.test(dc?.text ?? "") && /an orc fort/.test(dc.text), `C his scouts' report: ${dc?.text.slice(0, 120)}`);

  // the priest's blessing (after an alms quest)
  if (priestMob) {
    const prName = NR.namedRoleName(s.id, "priest");
    at(priestMob);
    let dq = talk("questGiver", prName, priestMob);
    dq = choose(dq, /help the poor/);
    const pq = Q.quests.find((q) => q.giver === "priest");
    result(pq?.kind === "deliver" && ["grain", "fruit", "clothes"].includes(pq.good), `S the priest asks alms: ${pq?.qty} ${pq?.good}`);
    choose(last(), /I'll do it/);
    state.stock[pq.good] = 500;
    choose(last(), /Deliver/);
    player.hp = 10;
    dq = talk("questGiver", prName, priestMob);
    dq = choose(dq, /Bless me/);
    result(player.hp > 10 && /healed/.test(dq?.text ?? ""), `S the priest's blessing heals (hp ${player.hp})`);
  }

  // ---- I ---- the forge indoors.
  const IN = await import("./src/interiors.ts");
  let forge = null;
  for (let y = s.y0; y <= s.y1 && !forge; y++) for (let x = s.x0; x <= s.x1; x++) if (state.tiles[tileIndex(x, y)] === TileType.Blacksmith) { forge = { x, y }; break; }
  state.cycleTick += 2 * GAME_DAY_TICKS; // the smith's cooldown is over: he has work again
  if (!forge) result(false, "I the village has a forge tile");
  else {
    at({ x: (forge.x + 0.5) * 32, y: (forge.y + 2.5) * 32 });
    const why = IN.enterInterior(player, forge.x, forge.y);
    const view = sent.filter((m) => m.type === "interior").at(-1)?.view;
    const sm = view?.npcs?.find((n) => n.act === "keeper");
    result(why === "" && sm?.name === smithName && sm.roleLabel === "Smith" && sm.quest === true, `I the forge's keeper is ${sm?.name} (${sm?.roleLabel}, "!" ${sm?.quest}) ${why}`);
    IN.exitInterior(player);
  }

  console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
}
