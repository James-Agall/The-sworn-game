// Forts phase B browser-check helper: stamps a real fort template (testHook stampSite) near the first Town
// Center, so you can walk to it, and lists every fort on the map. The server must run with
// COLONY_TEST_HOOKS=1 (and, for safety, a scratch COLONY_SAVE_DIR).
//   PORT=<server port> node stamp-site.mjs [thornwick|grakkar|hearthmoor|ironhold|riverwatch|list] [dx] [dy]
// Forts phase C: hearthmoor / ironhold / riverwatch stamp a neutral human settlement.
// dx / dy: offset of the fort centre from the first Town Center in tiles (default 30, 0); it looks up to 45
// tiles around that spot for clear ground. "list" only prints the forts world-gen placed.
// Forts phase D: `node stamp-site.mjs relation <settlement name> <value>` sets clan 0's relation (-100..100) to it.
// Forts phase D2: `node stamp-site.mjs quest <settlement name> <defend|clearCamp|deliver>` makes it post clan 0 that
// quest now (defend: jumps to nightfall and spawns 4 goblins outside its walls first). `quests` lists open ones.
// Forts phase E: `node stamp-site.mjs tradingpost [level]` puts a Trading Post (level 1-3, default 1) 4 tiles
// south-east of the first Town Center (rule-free; its wagon + escort appear within a second);
// `node stamp-site.mjs wagon [settlement name|auto]` sends the first Trading Post's wagon now (no trip cap; by
// day only); `node stamp-site.mjs wagons` lists every post, its wagon (leg, destination, cargo) and escort.
// Forts phase F: `node stamp-site.mjs vassal <settlement name>` sets clan 0's relation to 100 and makes it clan
// 0's vassal (forced even when your army is weaker; it may then break free at the next dawn);
// `node stamp-site.mjs tax <settlement name>` turns tribute on and collects one now (no power check);
// `node stamp-site.mjs levy <settlement name>` ends the levy's day now (it marches home) and clears the
// call-to-arms cooldown; `node stamp-site.mjs vassals` lists every settlement's liege, power and levy.
import WebSocket from "ws";

const PORT = process.env.PORT ?? 8080;
const template = process.argv[2] ?? "thornwick";
const dx = Number(process.argv[3] ?? 30);
const dy = Number(process.argv[4] ?? 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ws = new WebSocket(`ws://localhost:${PORT}`);
const replies = new Map();
let snap = null;
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "snapshot") snap = m;
  else if (m.type === "testHookResult") replies.set(m.op, m);
});
const hook = async (op, args = {}) => {
  replies.delete(op);
  ws.send(JSON.stringify({ type: "testHook", op, ...args }));
  for (let i = 0; i < 500 && !replies.has(op); i++) await sleep(10);
  return replies.get(op);
};
await new Promise((r) => ws.on("open", r));
while (!snap) await sleep(20);
const tc = snap.townCenters[0];
if (template === "relation") {
  const name = process.argv[3];
  const value = Number(process.argv[4]);
  const target = (await hook("sitesState"))?.sites.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
  if (!target || !Number.isFinite(value)) console.log(`Usage: relation <settlement name> <value>; no settlement "${name}"`);
  else {
    const r = await hook("diploSet", { siteId: target.id, relation: value });
    console.log(`${target.name}: relation ${r.relation} (${r.tier})`);
  }
} else if (["vassal", "tax", "levy", "vassals"].includes(template)) {
  const sitesNow = ((await hook("sitesState"))?.sites ?? []).filter((x) => x.faction === "human");
  const show = (r, name) => console.log(`${name}: ${r.vassalOf === null ? "free" : `vassal of clan ${r.vassalOf}`}, relation ${r.relation} (${r.tier}), power clan ${r.clanPower} vs ${r.sitePower}, tribute ${r.vassal?.tax ? "on" : "off"}${r.vassal?.lastTax ? ` (last day ${r.vassal.lastTax.day + 1}: ${r.vassal.lastTax.gold} gold)` : ""}, levy ${r.levies.length} on the field, garrison ${r.garrison}`);
  if (template === "vassals") {
    for (const x of sitesNow) show(await hook("vassalSet", { siteId: x.id }), x.name);
  } else {
    const name = process.argv[3];
    const target = sitesNow.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
    if (!target) console.log(`Usage: ${template} <settlement name>; no settlement "${name}" (${sitesNow.map((x) => x.name).join(", ")})`);
    else if (template === "vassal") show(await hook("vassalSet", { siteId: target.id, relation: 100, vassal: true }), target.name);
    else if (template === "tax") show(await hook("vassalSet", { siteId: target.id, tax: true, collect: true }), target.name);
    else show(await hook("vassalSet", { siteId: target.id, levyUntilTick: 0, levyCooldownUntilTick: 0, tick: true }), target.name);
  }
} else if (template === "quest" || template === "quests") {
  const sitesNow = (await hook("sitesState"))?.sites ?? [];
  if (template === "quest") {
    const name = process.argv[3];
    const kind = process.argv[4] ?? "deliver";
    const target = sitesNow.find((x) => x.name.toLowerCase() === String(name).toLowerCase() && x.faction === "human");
    if (!target || !["defend", "clearCamp", "deliver"].includes(kind)) console.log(`Usage: quest <settlement name> <defend|clearCamp|deliver>; no settlement "${name}"`);
    else {
      if (kind === "defend") {
        const raid = await hook("raidState");
        const day = raid.dayTicks + raid.nightTicks;
        await hook("setCycleTick", { tick: Math.floor(raid.cycleTick / day) * day + raid.dayTicks + 20 });
        for (let i = 0; i < 4; i++) await hook("spawnMob", { kind: "goblin", tx: target.x0 - 6 - i, ty: target.keepY });
      }
      const r = await hook("questPost", { siteId: target.id, kind });
      console.log(r?.quest ? `${target.name} posted quest #${r.quest.id} (${kind}) for ${r.quest.reward} gold: open Quests in the top bar` : `${target.name} would not post ${kind}: ${r?.problem}`);
    }
  }
  for (const q of (await hook("questState"))?.quests ?? []) {
    console.log(`  quest #${q.id} ${q.kind} from ${sitesNow.find((x) => x.id === q.siteId)?.name} (clan ${q.clan}) ${q.reward} gold${q.accepted ? ", accepted" : ""}${q.good ? `, ${q.qty} ${q.good}` : ""}${q.need ? `, slain ${q.kills}/${q.need}` : ""}`);
  }
} else if (template === "tradingpost" || template === "wagon" || template === "wagons") {
  const printPosts = (posts) => {
    for (const p of posts ?? []) {
      const w = p.wagon;
      console.log(`  Trading Post (${p.key}) Lv${p.levelNow}, auto ${p.auto ? "on" : "off"}: ${w ? `wagon ${Math.ceil(w.hp)}/${w.maxHp} HP, ${w.leg}${w.destName ? ` (${w.destName})` : ""}, cargo ${JSON.stringify(w.cargo)}` : `no wagon (rebuild at tick ${p.rebuildAtTick})`}; escort ${p.escorts.map((e) => e.kind).join(", ") || "none"}`);
    }
  };
  if (template === "tradingpost") {
    const level = Math.min(3, Math.max(1, Number(process.argv[3] ?? 1) || 1));
    printPosts((await hook("wagonPost", { tx: tc.x + 4, ty: tc.y + 4, level }))?.posts);
  } else if (template === "wagon") {
    const posts = (await hook("wagonState"))?.posts ?? [];
    if (posts.length === 0) console.log("No Trading Post: build one (or `node stamp-site.mjs tradingpost`)");
    else {
      const name = process.argv[3];
      const target = name && name !== "auto" ? (await hook("sitesState"))?.sites.find((x) => x.name.toLowerCase() === name.toLowerCase()) : null;
      if (name && name !== "auto" && !target) console.log(`No settlement "${name}": sending to the best destination`);
      const [tx, ty] = posts[0].key.split(",").map(Number);
      const r = await hook("wagonSend", { tx, ty, dest: target ? `s:${target.id}` : "auto" });
      console.log(r?.problem ? `Wagon not sent: ${r.problem}` : "Wagon sent: watch it leave (time controls speed it up)");
      printPosts(r?.posts);
    }
  } else printPosts((await hook("wagonState"))?.posts);
  ws.close();
  process.exit(0);
} else if (template !== "list") {
  const r = await hook("stampSite", { template, dx, dy, search: 45 });
  if (!r) {
    console.log("No reply: is the server running with COLONY_TEST_HOOKS=1?");
    process.exit(1);
  }
  if (!r.site) console.log(`Could not stamp ${template} near (${tc.x + dx}, ${tc.y + dy}): ${r.problem}`);
  else console.log(`Stamped ${r.site.name}: keep at (${r.site.keepX}, ${r.site.keepY}), ${r.site.keepX - tc.x} / ${r.site.keepY - tc.y} tiles from the Town Center`);
}
const st = await hook("sitesState");
for (const s of st?.sites ?? []) {
  const d = Math.hypot(s.keepX - tc.x, s.keepY - tc.y);
  const human = s.faction === "human" ? `, ${s.template}, ${s.provoked ? "HOSTILE" : "neutral"}, relation ${s.relation}` : "";
  console.log(`  ${s.name} (${s.faction}, tier ${s.tier}${human}) keep (${s.keepX}, ${s.keepY}), ${d.toFixed(0)} tiles away (dx ${s.keepX - tc.x}, dy ${s.keepY - tc.y}), garrison ${s.alive.length - (s.workerMobs?.length ?? 0)}/${s.garrisonMax}${s.cleared ? ", cleared" : ""}`);
}
ws.close();
process.exit(0);
