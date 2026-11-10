// Scripted test: Stardew phase 5c, building interiors (ROADMAP "Stardew layer — phase 5c"). The hero enters an own
// House through its door with E (the real `interact` message) and by walking north into it, walks the interior map
// (its own collision grid: walls, solid furniture; the world body waits at the door, hidden), stores pack goods in the
// chest, sleeps in the bed (night: skip to dawn, rest / energy full; day: nap), leaves on the exit mat and with Esc
// near it; nothing hurts a hero indoors; entering is refused with enemies near the door; the Town Center hall's
// people talk through the usual dialogue (keeper: the building panel, folk: "How do you fare?"); a settlement's
// Market has its trader; chests survive save / load (the hero is outside after a load).
// Gap closure G5 (section 11): every layout validates, 3 variants per type picked deterministically per building,
// living NPCs (a resident wanders by day, sits at a table at dusk, sleeps in a bed at night; keepers work at their
// station; facing follows movement; greeting bubbles), tavern patrons (2-6 seated by time of day, own villagers off
// duty at night, rumours, buying a drink), the tavern's stairs to its guest rooms.
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
const T = { Empty: 0, House: 13, TownCenter: 12, Market: 28, Church: 20, Blacksmith: 26, Tavern: 31 };
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
// Sections 1-10 walk the phase 5c layouts (variant 0) by their tile coordinates.
await ins({ variant: 0 });
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

// 11. Gap closure G5.
{
  let R = await ins();
  result(Array.isArray(R.templateErrors) && R.templateErrors.length === 0, `every interior layout validates (${(R.templateErrors ?? []).slice(0, 4).join("; ")})`);
  // 3 variants of the house, each a different map; with no forcing the pick is stable per building.
  const sizes = [];
  for (const vv of [0, 1, 2]) {
    await ins({ variant: vv, exit: true });
    R = await ins({ enter: { tx: H.x, ty: H.y } });
    sizes.push(`${R.view?.map?.variant}:${R.view?.map?.w}x${R.view?.map?.h}`);
  }
  await ins({ exit: true, variant: null });
  result(new Set(sizes).size === 3 && sizes.every((z, i) => z.startsWith(`${i}:`)), `house variants 0-2 are three layouts (${sizes.join(", ")})`);
  const picks = [];
  for (const [dx, dy] of [[0, 0], [-3, 3], [3, 3], [-3, -3], [3, -3], [0, 3]]) {
    const hx = H.x + dx;
    const hy = H.y + dy;
    if (dx || dy) await setTile(hx, hy, T.House);
    const a = await ins({ enter: { tx: hx, ty: hy } });
    await ins({ exit: true });
    const b2 = await ins({ enter: { tx: hx, ty: hy } });
    picks.push([a.inside?.variant, b2.inside?.variant]);
    await ins({ exit: true });
    if (dx || dy) await setTile(hx, hy, T.Empty);
  }
  result(picks.every(([a, b2]) => a === b2 && a >= 0 && a <= 2) && new Set(picks.map((q) => q[0])).size >= 2, `the pick is deterministic per building and varies between them (${JSON.stringify(picks)})`);
  await ins({ variant: 0 });

  if (town) {
    await hook("diploSet", { siteId: town.id, relation: 30 });
    const liveOf = (R2, name) => {
      const n = R2.view?.npcs?.find((q) => q.name === name);
      return n && R2.live.find((q) => q.id === n.id);
    };
    // A settlement house: its villager wanders by day, sits at the table at dusk, sleeps in the bed at night.
    const hs = { x: H.x, y: H.y - 2 };
    await setTile(hs.x, hs.y, T.House);
    await hook("setOwner", { tx: hs.x, ty: hs.y, siteId: town.id });
    await hook("setCycleTick", { tick: 400 });
    R = await ins({ enter: { tx: hs.x, ty: hs.y } });
    const res = R.view?.npcs?.find((q) => q.act === "resident");
    // Stand far from it (the hero stops NPCs close by).
    await ins({ at: { x: px(9), y: px(4) } });
    const seenAt = new Set();
    let walked = null;
    for (let k = 0; k < 30; k++) {
      await ff(10);
      R = await ins();
      const n = liveOf(R, res?.name);
      if (!n) break;
      seenAt.add(`${Math.round(n.x)},${Math.round(n.y)}`);
      if (n.pose === "walk" && !walked) {
        await ff(2);
        const n2 = liveOf(await ins(), res.name);
        const dx = n2.x - n.x;
        const dy = n2.y - n.y;
        const want = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "l" : "r") : dy < 0 ? "u" : "d";
        if (Math.hypot(dx, dy) > 0.01) walked = { face: n2.face, want };
      }
    }
    result(!!res && seenAt.size >= 2, `day: the resident ${res?.name} wanders (${seenAt.size} tiles: ${[...seenAt].join(" ")})`);
    result(!!walked && walked.face === walked.want, `facing follows movement (${JSON.stringify(walked)})`);
    await hook("setCycleTick", { tick: 5000 });
    await ff(200);
    R = await ins();
    let n = liveOf(R, res?.name);
    const chair = R.view.map.props.some((q) => q.prop === "chair" && q.x === Math.round(n?.x) && q.y === Math.round(n?.y));
    result(n?.pose === "sit" && chair, `dusk: at the table (${JSON.stringify(n)})`);
    await hook("setCycleTick", { tick: 6300 });
    await ff(200);
    R = await ins();
    n = liveOf(R, res?.name);
    const bed = R.view.map.props.some((q) => (q.prop === "bed" || q.prop === "bedFine") && q.x === Math.round(n?.x) && q.y === Math.round(n?.y));
    result(n?.pose === "sleep" && bed, `night: asleep in a bed (${JSON.stringify(n)})`);
    await ins({ exit: true });

    // A settlement smithy: the smith stays at the anvil working; a greeting bubble when the hero comes close.
    const sm = { x: H.x + 2, y: H.y - 2 };
    await setTile(sm.x, sm.y, T.Blacksmith);
    await hook("setOwner", { tx: sm.x, ty: sm.y, siteId: town.id });
    await hook("setCycleTick", { tick: 400 });
    R = await ins({ enter: { tx: sm.x, ty: sm.y } });
    const smith = R.view?.npcs?.find((q) => q.act === "keeper");
    await ff(60);
    R = await ins();
    n = liveOf(R, smith?.name);
    result(!!smith && n?.pose === "work" && n.x === smith.x && n.y === smith.y && !n.say, `the smith works at the station (${JSON.stringify(n)})`);
    await ins({ at: { x: px(smith.x), y: px(smith.y + 2) } });
    await ff(6);
    n = liveOf(await ins(), smith.name);
    result(typeof n?.say === "string" && n.say.length > 0, `greeting bubble: "${n?.say}"`);
    await ins({ exit: true });

    // A settlement tavern: patrons seated by time of day; rumours; a drink; the stairs to the guest rooms.
    const tv = { x: H.x - 2, y: H.y - 2 };
    await setTile(tv.x, tv.y, T.Tavern);
    await hook("setOwner", { tx: tv.x, ty: tv.y, siteId: town.id });
    R = await ins({ enter: { tx: tv.x, ty: tv.y } });
    await ff(4);
    R = await ins();
    const pats = (R2) => R2.view.npcs.filter((q) => q.roleLabel === "Patron");
    const seated = pats(R).every((q) => R.live.find((l) => l.id === q.id)?.pose === "sit");
    result(pats(R).length >= 2 && pats(R).length <= 3 && seated, `tavern by day: ${pats(R).length} patrons seated (${pats(R).map((q) => q.name).join(", ")})`);
    const pat = pats(R)[0];
    await ins({ at: { x: px(pat.x), y: px(pat.y + 1) } });
    await pressE();
    if (c.dialogue?.dialogue?.npc?.role !== "patron") {
      // Another patron sat closer: ask for this one.
      const pick = c.dialogue?.dialogue?.choices?.findIndex((x) => x.label.includes(pat.name));
      if (pick >= 0) await life({ choice: pick });
    }
    let d2 = c.dialogue?.dialogue;
    result(d2?.npc?.role === "patron" && d2.choices.some((x) => /rumours/.test(x.label)) && d2.choices.some((x) => /drink/.test(x.label)), `patron dialogue: ${d2?.choices?.map((x) => x.label).join(" / ")}`);
    await life({ choice: d2.choices.findIndex((x) => /rumours/.test(x.label)) });
    result(/tiles|camps? within|Quiet roads/.test(c.dialogue?.dialogue?.text ?? ""), `rumour: ${c.dialogue?.dialogue?.text}`);
    await life({ choice: c.dialogue.dialogue.choices.findIndex((x) => /^Back/.test(x.label)) });
    const g0 = (await hook("setStock", { stock: { gold: 50 } })).stock.gold;
    await life({ rest: 40 });
    await life({ choice: c.dialogue.dialogue.choices.findIndex((x) => /drink/.test(x.label)) });
    const g1 = (await hook("setStock", { stock: {} })).stock.gold;
    L = await life();
    result(g0 - g1 === 3 && L.life.rest >= 51 && /ale/.test(c.dialogue?.dialogue?.text ?? ""), `a drink: gold ${g0} -> ${g1}, rest 40 -> ${L.life.rest?.toFixed?.(1)}`);
    const bal = await hook("balanceState");
    result((bal?.parts?.drink ?? 0) > 0, `the drink lifts colony happiness (+${bal?.parts?.drink})`);
    await life({ choice: c.dialogue.dialogue.choices.findIndex((x) => /Farewell/.test(x.label)) });
    await hook("setCycleTick", { tick: 6300 });
    await ff(25);
    R = await ins();
    result(pats(R).length >= 4 && pats(R).length <= 6, `tavern at night: ${pats(R).length} patrons`);
    // Upstairs (variant 0: the stairs at 1,7): guests asleep; Esc refused; back down beside the stairs.
    await ff(35);
    await ins({ at: { x: px(1), y: px(7) } });
    await ff(2);
    R = await ins();
    const ups = R.view?.npcs ?? [];
    await ff(4);
    R = await ins();
    result(R.inside?.storey === 1 && R.view.map.storey === 1 && ups.length > 0 && R.live.every((q) => q.pose === "sleep"), `up the stairs: ${R.view?.title}, ${ups.length} asleep (${R.live.map((q) => q.pose).join(",")})`);
    let ev2 = c.events.length;
    send({ type: "interiorExit" });
    await sleep(150);
    R = await ins();
    result(R.inside?.storey === 1 && /stairs down/.test(eventsSince(ev2)), `Esc upstairs refused (${eventsSince(ev2)})`);
    const dn = R.view.map.stairs;
    await ff(35);
    await ins({ at: { x: px(dn.x), y: px(dn.y) } });
    await ff(2);
    R = await ins();
    result(R.inside?.storey === 0 && Math.abs(R.inside.x - px(1)) + Math.abs(R.inside.y - px(7)) <= TILE + 1, `down again beside the stairs (${R.inside?.x}, ${R.inside?.y})`);
    await ins({ exit: true });
    // Your own tavern at night: your villagers off duty drink there.
    await hook("setOwner", { tx: tv.x, ty: tv.y, siteId: null });
    await setTile(tv.x, tv.y, T.Empty);
    await setTile(tv.x, tv.y, T.Tavern);
    R = await ins({ enter: { tx: tv.x, ty: tv.y } });
    const own = pats(R).filter((q) => !/traveller/.test(q.name));
    result(pats(R).length >= 4 && own.length >= 1, `own tavern at night: ${pats(R).length} patrons, ${own.length} of yours (${pats(R).map((q) => q.name).join(", ")})`);
    await ins({ exit: true });
    await hook("setCycleTick", { tick: 400 });
    for (const q of [hs, sm, tv]) await setTile(q.x, q.y, T.Empty);
  }
}

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
