// Scripted test: Stardew phase 5c, building interiors (ROADMAP "Stardew layer — phase 5c"). The hero enters an own
// House through its door with E (the real `interact` message) and by walking north into it, walks the interior map
// (its own collision grid: walls, solid furniture; the world body waits at the door, hidden), stores pack goods in the
// chest, sleeps in the bed (night: skip to dawn, rest / energy full; day: nap), leaves on the exit mat and with Esc
// near it; nothing hurts a hero indoors; entering is refused with enemies near the door; the Town Center hall's
// people talk through the usual dialogue (keeper: the building panel, folk: "How do you fare?"); a settlement's
// Market has its trader; chests survive save / load (the hero is outside after a load).
// Needs a FRESH private server (default 160 map: its human settlements have Markets): `npm test -- interiors`.
import WebSocket from "ws";

const PORT = process.env.PORT ?? 8080;
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = { Empty: 0, House: 13, TownCenter: 12, Market: 28, Church: 20 };
const TILE = 32;
const px = (t) => t * TILE + 16;

const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, events: [], hook: new Map(), save: null, welcomes: 0, interior: [], dialogue: null };
c.ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") {
    c.welcome = m;
    c.welcomes++;
  } else if (m.type === "snapshot") c.snap = m;
  else if (m.type === "event") c.events.push(m.text);
  else if (m.type === "testHookResult") c.hook.set(m.op, m);
  else if (m.type === "saveResult") c.save = m;
  else if (m.type === "interior") c.interior.push(m.view);
  else if (m.type === "dialogue") c.dialogue = m;
});
const send = (m) => c.ws.send(JSON.stringify(m));
const hook = async (op, args = {}) => {
  c.hook.delete(op);
  send({ type: "testHook", op, ...args });
  for (let i = 0; i < 3000 && !c.hook.has(op); i++) await sleep(10);
  return c.hook.get(op);
};
const setTile = (x, y, tile) => hook("setTileRaw", { tx: x, ty: y, tile });
const life = (args = {}) => hook("heroLife", args);
const ff = (ticks) => hook("fastForward", { ticks });
const ins = (args = {}) => hook("interior", args);
const stand = (x, y) => hook("teleportPlayer", { x: px(x), y: px(y) });
const eventsSince = (n) => c.events.slice(n).join(" | ");
const lastView = () => c.interior[c.interior.length - 1];
// The real E message, then the server's answer (an interior view / a dialogue / an event).
async function pressE() {
  const n = c.interior.length;
  const e = c.events.length;
  c.dialogue = null;
  send({ type: "interact" });
  for (let i = 0; i < 100 && c.interior.length === n && c.events.length === e && !c.dialogue; i++) await sleep(10);
}
async function walk(dx, dy, ticks) {
  send({ type: "input", dx, dy });
  await sleep(60);
  await ff(ticks);
  send({ type: "input", dx: 0, dy: 0 });
  await sleep(60);
  await ff(1);
}
async function mySnap() {
  const tick = c.snap?.tick;
  for (let i = 0; i < 100 && c.snap?.tick === tick; i++) await sleep(10);
  return c.snap?.players?.find((p) => p.id === c.welcome.id);
}

await new Promise((r) => c.ws.on("open", r));
while (!c.welcome || !c.snap) await sleep(20);
send({ type: "pause", paused: true });
await hook("setRaids", { enabled: false });
await hook("setCycleTick", { tick: 0 });
await life({ needs: true, energy: 100, food: 100, rest: 100, pack: {} });

const W = c.welcome.worldTilesX;
const tc = (await hook("constructionState")).townCenters[0];
// A House on cleared ground away from the Town Center; its door is the tile below it.
const H = { x: Math.max(6, Math.min(W - 10, tc.x + (tc.x < W / 2 ? 12 : -12))), y: Math.max(6, Math.min(W - 10, tc.y + 8)) };
for (let y = H.y - 3; y <= H.y + 4; y++) for (let x = H.x - 3; x <= H.x + 3; x++) await setTile(x, y, T.Empty);
await setTile(H.x, H.y, T.House);
const door = { x: H.x, y: H.y + 1 };

// 1. E on the door tile enters (house template, own: chest + bed); the world body waits at the door, hidden.
await stand(door.x, door.y);
await pressE();
let v = lastView();
result(v?.map?.templateId === "house" && v.key === `${H.x},${H.y}` && v.canSleep === true && v.chest && Object.keys(v.chest).length === 0, `E at the door: inside the house (${JSON.stringify({ t: v?.map?.templateId, key: v?.key, sleep: v?.canSleep, chest: v?.chest, title: v?.title })})`);
let I = await ins();
result(I.inside && Math.abs(I.world.x - px(door.x)) < 1 && Math.abs(I.world.y - px(door.y)) < 1, `world position held at the door (${JSON.stringify(I.world)}), inside at ${I.inside && [I.inside.x, I.inside.y]}`);
send({ type: "pause", paused: false });
let me = await mySnap();
send({ type: "pause", paused: true });
result(me?.inside?.key === `${H.x},${H.y}`, `snapshot marks the player inside (${JSON.stringify(me?.inside)})`);

// 2. Collision: north up the open column to the back wall (row 0), then west into the hearth at (4, 1).
await walk(0, -1, 60);
I = await ins();
result(I.inside.y >= 1 * TILE + 10 - 0.01 && I.inside.y < 1 * TILE + 10 + 6 && I.inside.x === px(5), `north stops at the back wall (y ${I.inside.y.toFixed(1)}: one step short of 42 at most)`);
await walk(-1, 0, 40);
I = await ins();
result(I.inside.x >= 5 * TILE + 10 - 0.01 && I.inside.x < 5 * TILE + 10 + 6, `west stops at the hearth (x ${I.inside.x.toFixed(1)})`);
// Bed at (1,1): rest of the row (2,1) is free; the bed itself blocks.
await ins({ at: { x: px(2), y: px(2) } });
await walk(0, -1, 30);
await walk(-1, 0, 30);
I = await ins();
result(I.inside.x >= 2 * TILE + 10 - 1.5 && I.inside.y >= 1 * TILE + 10 - 1.5, `the bed is solid (${I.inside.x.toFixed(1)}, ${I.inside.y.toFixed(1)})`);

// 3. Nothing reaches the hero indoors.
const hp0 = me.hp;
await hook("damagePlayer", { amount: 40 });
send({ type: "pause", paused: false });
me = await mySnap();
send({ type: "pause", paused: true });
result(me.hp === hp0, `damage ignored indoors (hp ${me.hp})`);

// 4. Chest: store the pack, take some back.
await life({ pack: { wood: 10, rock: 3, meat: 2 } });
await ins({ at: { x: px(9), y: px(2) } });
await pressE();
result(c.dialogue?.dialogue?.npc?.name === "Chest" && /Store everything/.test(c.dialogue.dialogue.choices[0].label), `E by the chest opens it (${c.dialogue?.dialogue?.choices.map((x) => x.label).join(" / ")})`);
let L = await life({ choice: 0 });
I = await ins();
const ch = I.view.chest;
result(ch.wood === 10 && ch.rock === 3 && ch.meat === 2 && Object.keys(L.life.pack).length === 0, `stored everything: chest ${JSON.stringify(ch)}, pack ${JSON.stringify(L.life.pack)}`);
const takeWood = c.dialogue.dialogue.choices.findIndex((x) => /Take the wood/.test(x.label));
L = await life({ choice: takeWood });
I = await ins();
result(L.life.pack.wood === 10 && !I.view.chest.wood && I.view.chest.rock === 3, `took the wood back: pack ${JSON.stringify(L.life.pack)}, chest ${JSON.stringify(I.view.chest)}`);
await life({ choice: c.dialogue.dialogue.choices.findIndex((x) => /^Close/.test(x.label)) });

// 5. The bed: by day only a nap (resting; the bed's x3); by night sleep to dawn, rest and energy full.
await ins({ at: { x: px(2), y: px(2) } });
await life({ rest: 30, energy: 20 });
await pressE();
const sleepIdx = c.dialogue?.dialogue?.choices.findIndex((x) => /Sleep until dawn/.test(x.label));
result(c.dialogue?.dialogue?.npc?.name === "Your bed" && c.dialogue.dialogue.choices[sleepIdx]?.disabled, `bed by day: sleep disabled (${c.dialogue?.dialogue?.choices.map((x) => `${x.label}${x.disabled ? ` [${x.disabled}]` : ""}`).join(" / ")})`);
L = await life({ choice: 1 });
const rest0 = L.life.rest;
await ff(40);
L = await life();
result(L.snap.resting === true && L.life.rest - rest0 >= 5, `nap: resting in the bed (+${(L.life.rest - rest0).toFixed(1)} rest in 2 s)`);
await hook("setCycleTick", { tick: 300 * 20 + 200 });
await life({ rest: 30, energy: 20 });
await pressE();
const before = (await ins()).cycleTick;
L = await life({ choice: c.dialogue.dialogue.choices.findIndex((x) => /Sleep until dawn/.test(x.label)) });
I = await ins();
result(L.life.rest === 100 && L.life.energy === 100 && I.night === true && I.cycleTick === 375 * 20 - 1, `slept: rest ${L.life.rest}, energy ${L.life.energy}, tick ${before} -> ${I.cycleTick} (dawn next)`);
await ff(2);
I = await ins();
result(I.night === false, `dawn after the sleep (tick ${I.cycleTick})`);

// 6. Leaving: Esc far from the mat is refused; walking onto the mat leaves, back at the door.
let ev = c.events.length;
await ins({ at: { x: px(5), y: px(1) } });
send({ type: "interiorExit" });
await sleep(150);
I = await ins();
result(I.inside && /door mat/.test(eventsSince(ev)), `Esc away from the mat: still inside (${eventsSince(ev)})`);
await ins({ at: { x: px(5), y: px(5) } });
let n0 = c.interior.length;
await walk(0, 1, 4);
I = await ins();
result(!I.inside && c.interior.length > n0 && lastView() === null && Math.abs(I.world.x - px(door.x)) < 1 && Math.abs(I.world.y - px(door.y)) < 16, `walked onto the mat: outside at the door (${JSON.stringify(I.world)}, door ${px(door.x)}, ${px(door.y)})`);
await stand(door.x, door.y);
// Walking north into the house from the door tile enters it (bump); Esc near the mat leaves.
await ff(40);
await walk(0, -1, 10);
I = await ins();
result(!!I.inside, `walking north into the house enters it`);
await ins({ at: { x: px(5), y: px(5) - 8 } });
send({ type: "interiorExit" });
await sleep(150);
I = await ins();
result(!I.inside, `Esc next to the mat leaves`);

// 7. Enemies near the door: entering is refused.
await stand(door.x, door.y);
const sp = await hook("spawnMob", { kind: "goblin", tx: door.x + 3, ty: door.y + 1 });
ev = c.events.length;
await pressE();
I = await ins();
result(!I.inside && /Enemies are too close/.test(eventsSince(ev)), `refused near enemies (${eventsSince(ev)})`);
if (sp?.id) await hook("damageMob", { mobId: sp.id, amount: 99999 });
await ff(2);

// 8. The Town Center hall: its people inside, talked to through the usual dialogue.
for (let x = tc.x - 1; x <= tc.x + 1; x++) await setTile(x, tc.y + 1, T.Empty);
await ins({ enter: { tx: tc.x, ty: tc.y } });
v = lastView();
result(v?.map?.templateId === "hall" && v.npcs.length > 0, `Town Center: the hall with ${v?.npcs?.length} people (${v?.npcs?.map((n) => `${n.name} ${n.roleLabel} ${n.kind}`).join(", ")})`);
const npc = v.npcs[0];
await ins({ at: { x: px(npc.x), y: px(npc.y + 1) } });
await pressE();
const d = c.dialogue?.dialogue;
result(d && d.npc.name === npc.name && d.choices.length > 0, `E talks to ${npc.name} (${d?.npc?.roleLabel}): ${d?.choices?.map((x) => x.label).join(" / ")}`);
const fare = d?.choices.findIndex((x) => /fare/.test(x.label));
L = await life({ choice: fare });
result(fare >= 0 && L.talking && /food|bed|roof|work/i.test(c.dialogue?.dialogue?.text ?? ""), `"How do you fare?" answers: ${c.dialogue?.dialogue?.text}`);
await life({ choice: c.dialogue.dialogue.choices.findIndex((x) => /Farewell/.test(x.label)) });
await ins({ exit: true });

// 9. A settlement's buildings: a Market (its trader, trade) and a Church (its priest at the altar). Placed beside the
// house and handed to a standing human settlement (setOwner), so the test does not depend on the generated towns.
let town = (await hook("sitesState")).sites.find((st) => st.faction === "human" && !st.cleared && !st.captured);
for (const [dx, dy] of [[30, 0], [-30, 0], [0, 30], [0, -30], [30, 30], [-30, -30]]) {
  if (town) break;
  const st = await hook("stampSite", { template: "hearthmoor", dx, dy, search: 20 });
  if (st?.site) town = st.site;
}
if (town) {
  const mk = { x: H.x - 2, y: H.y };
  const chu = { x: H.x + 2, y: H.y };
  await setTile(mk.x, mk.y, T.Market);
  await setTile(chu.x, chu.y, T.Church);
  await hook("setOwner", { tx: mk.x, ty: mk.y, siteId: town.id });
  await hook("setOwner", { tx: chu.x, ty: chu.y, siteId: town.id });
  const r = await ins({ enter: { tx: mk.x, ty: mk.y } });
  v = lastView();
  const trader = v?.npcs?.[0];
  result(r.why === "" && v.map.templateId === "shop" && v.chest === null && trader?.roleLabel === "Trader", `settlement Market: ${v?.title}, trader ${trader?.name}, no chest of yours (${r.why})`);
  await ins({ at: { x: px(trader.x), y: px(trader.y + 2) } });
  await pressE();
  result(c.dialogue?.dialogue?.npc?.role === "trader" && c.dialogue.dialogue.choices.some((x) => /goods/.test(x.label)), `trader dialogue: ${c.dialogue?.dialogue?.choices?.map((x) => x.label).join(" / ")}`);
  await life({ choice: c.dialogue.dialogue.choices.findIndex((x) => /Farewell/.test(x.label)) });
  await ins({ exit: true });
  await ins({ enter: { tx: chu.x, ty: chu.y } });
  v = lastView();
  const pr = v?.npcs?.find((n) => n.roleLabel === "Priest");
  result(v?.map?.templateId === "church" && pr?.kind === "bishop" && v.map.props.some((q) => q.prop === "altar"), `settlement Church: altar and ${pr?.name}`);
  await ins({ at: { x: px(pr.x), y: px(pr.y + 2) } });
  await pressE();
  result(c.dialogue?.dialogue?.npc?.roleLabel === "Priest" && c.dialogue.dialogue.choices.some((x) => /needs doing/.test(x.label)), `priest dialogue: ${c.dialogue?.dialogue?.choices?.map((x) => x.label).join(" / ")}`);
  await life({ choice: c.dialogue.dialogue.choices.findIndex((x) => /Farewell/.test(x.label)) });
  await ins({ exit: true });
  // Hostile: the door is barred.
  await hook("diploSet", { siteId: town.id, relation: -100 });
  const barred = await ins({ enter: { tx: mk.x, ty: mk.y } });
  result(!barred.inside && /barred/.test(barred.why ?? ""), `hostile settlement: ${barred.why}`);
} else result(false, `no standing human settlement`);

// 10. Save / load: the chest is kept; after a load everyone is outside.
await ins({ enter: { tx: H.x, ty: H.y } });
c.save = null;
send({ type: "saveGame", slot: "slot1" });
for (let i = 0; i < 300 && !c.save; i++) await sleep(10);
result(c.save?.ok === true, `saved (${c.save?.error ?? "ok"})`);
await ins({ at: { x: px(9), y: px(2) } });
await pressE();
await life({ choice: 0 });
I = await ins();
result(I.view.chest.wood === 10, `chest changed after the save (${JSON.stringify(I.view.chest)})`);
c.save = null;
const w0 = c.welcomes;
send({ type: "loadGame", slot: "slot1" });
for (let i = 0; i < 300 && (!c.save || c.welcomes === w0); i++) await sleep(10);
send({ type: "pause", paused: true });
await sleep(100);
I = await ins();
const saved = I.chests.find(([k]) => k === `${H.x},${H.y}`)?.[1];
result(!I.inside && saved && saved.rock === 3 && saved.meat === 2 && !saved.wood, `loaded: outside, chest ${JSON.stringify(saved)}`);

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
c.ws.close();
process.exit(fails === 0 ? 0 : 1);
