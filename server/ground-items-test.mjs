// Scripted test: Inventory 2026-11-26 (INVENTORY-2026-11-26.md, server/src/groundItems.ts), the ground drop system.
// Two heroes (two profiles): dropping goods (quantity capped to what is carried, merging on one tile) and gear (pack
// only, never an equipped piece, never another hero's), validation / abuse (bad types, negative / fractional / huge
// quantities, indoors, dead, no clear ground, the drop rate limit), the dropper's short pickup delay, pickup by the
// message and by E (reach, weight cap with the remainder left on the ground, the 40-item gear cap), the snapshot's
// `ground` list (near stacks only, not resent while unchanged), the per-world cap (oldest out), the 3-day despawn
// (fastForward), save / load of the stacks and a new world clearing them.
// Needs a FRESH private server: `npm test -- ground-items`.
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
const T = { Empty: 0, Water: 35, House: 13 };
const TILE = 32;
const px = (t) => t * TILE + 16;

function connect(profile) {
  const c = { ws: new WebSocket(`ws://localhost:${PORT}/?profile=${profile}`), welcome: null, snap: null, events: [], hook: new Map(), saves: [], ground: null, groundMsgs: 0, snaps: 0, welcomes: 0 };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") {
      c.welcome = m;
      c.welcomes++;
      c.ground = null;
    } else if (m.type === "snapshot") {
      c.snap = m;
      c.snaps++;
      if (m.ground) {
        c.ground = m.ground;
        c.groundMsgs++;
      }
    } else if (m.type === "event") c.events.push(m.text);
    else if (m.type === "testHookResult") c.hook.set(m.op, m);
    else if (m.type === "saveResult") c.saves.push(m);
  });
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.call = async (op, args = {}, waitMs = 60000) => {
    c.hook.delete(op);
    c.send({ type: "testHook", op, ...args });
    for (let i = 0; i < waitMs / 10 && !c.hook.has(op); i++) await sleep(10);
    return c.hook.get(op);
  };
  c.since = (n) => c.events.slice(n).join(" | ");
  return c;
}
const A = connect("ground-a");
const B = connect("ground-b");
await Promise.all([A, B].map((c) => new Promise((r) => c.ws.on("open", r))));
while (!A.welcome || !A.snap || !B.welcome || !B.snap) await sleep(20);
A.send({ type: "pause", paused: true });
await A.call("setRaids", { enabled: false });
await A.call("heroLife", { needs: false, pack: {} });
await B.call("heroLife", { pack: {} });
await A.call("groundItems", { clear: true });

const W = A.welcome.worldTilesX;
const tc = (await A.call("constructionState")).townCenters[0];
// A test field: 7x7 cleared ground away from the Town Center, with nobody standing within 4 tiles of it.
const S = { x: Math.max(8, Math.min(W - 9, tc.x + (tc.x < W / 2 ? 14 : -14))), y: Math.max(8, Math.min(W - 9, tc.y + 6)) };
for (let y = S.y - 3; y <= S.y + 3; y++) for (let x = S.x - 3; x <= S.x + 3; x++) await A.call("setTileRaw", { tx: x, ty: y, tile: T.Empty });
const tooClose = A.snap.colonists.filter((c) => Math.hypot(c.x - px(S.x), c.y - px(S.y)) < 4 * TILE);
for (const c of tooClose) await A.call("damageColonist", { id: c.id, amount: 99999 });
const stand = (c, x, y) => c.call("teleportPlayer", { x, y });
const ground = async () => (await A.call("groundItems")).items;
const lifeOf = async (c) => (await c.call("heroLife")).life;
const invOf = async (c) => (await c.call("heroState")).profile.inventory;
// Snapshots go out while paused; wait for the next one.
async function nextSnap(c) {
  const n = c.snaps;
  for (let i = 0; i < 200 && c.snaps === n; i++) await sleep(10);
}
await stand(A, px(S.x), px(S.y));
await stand(B, px(S.x) + 20, px(S.y));

// 1. Drop goods: the real message; the stack lies on the hero's tile; the same good there merges.
await A.call("heroLife", { pack: { wood: 10, rock: 5 } });
let ev = A.events.length;
A.send({ type: "dropGood", good: "wood", qty: 4 });
let g = await ground();
let L = await lifeOf(A);
result(g.length === 1 && g[0].kind === "good" && g[0].good === "wood" && g[0].qty === 4 && g[0].x === px(S.x) && g[0].y === px(S.y) && L.pack.wood === 6,
  `drop 4 wood: one stack ${JSON.stringify(g.map((i) => [i.good, i.qty, i.x, i.y]))}, pack ${JSON.stringify(L.pack)} (${A.since(ev)})`);
A.send({ type: "dropGood", good: "wood", qty: 2 });
A.send({ type: "dropGood", good: "rock", qty: 5 });
g = await ground();
L = await lifeOf(A);
const woodStack = g.find((i) => i.good === "wood");
result(g.length === 2 && woodStack?.qty === 6 && g.find((i) => i.good === "rock")?.qty === 5 && L.pack.wood === 4 && !L.pack.rock,
  `merge: 2 more wood joins the stack (${woodStack?.qty}), 5 rock its own (${g.length} stacks), pack ${JSON.stringify(L.pack)}`);
await nextSnap(A);
await nextSnap(A);
result(A.ground?.length === 2 && A.ground.some((s) => s.k === "g" && s.good === "wood" && s.qty === 6), `snapshot ground lists both stacks near A (${JSON.stringify(A.ground)})`);

// 2. Validation and abuse: nothing changes for a bad good, a bad / negative / fractional quantity or a good not carried;
// a huge quantity drops what is carried.
await sleep(1100);
const before = JSON.stringify(await ground());
ev = A.events.length;
for (const m of [{ good: "gold", qty: 1 }, { good: "wood", qty: -3 }, { good: "wood", qty: 0 }, { good: "wood", qty: 1.5 }, { good: "wood", qty: "3" }, { good: { x: 1 }, qty: 1 }, { good: "rock", qty: 2 }]) A.send({ type: "dropGood", ...m });
A.send({ type: "dropGear", itemId: 42 });
A.send({ type: "pickupGround", id: { evil: true } });
A.send({ type: "pickupGround", id: "g999999" });
await sleep(150);
L = await lifeOf(A);
result(JSON.stringify(await ground()) === before && L.pack.wood === 4 && /Choose how many to drop/.test(A.since(ev)) && /You carry no stone/.test(A.since(ev)) && /no longer there/.test(A.since(ev)),
  `bad drops / pickups change nothing (pack ${JSON.stringify(L.pack)}): ${A.since(ev)}`);
A.send({ type: "dropGood", good: "wood", qty: 1e9 });
g = await ground();
L = await lifeOf(A);
result(g.find((i) => i.good === "wood")?.qty === 10 && !L.pack.wood, `a huge quantity drops only what is carried (stack ${g.find((i) => i.good === "wood")?.qty}, pack ${JSON.stringify(L.pack)})`);

// 3. Rate limit: at most 6 drops a second.
await sleep(1100);
await A.call("heroLife", { pack: { grain: 20 } });
ev = A.events.length;
for (let i = 0; i < 10; i++) A.send({ type: "dropGood", good: "grain", qty: 1 });
await sleep(150);
L = await lifeOf(A);
result(L.pack.grain === 14 && /Slow down/.test(A.since(ev)), `10 drops in a burst: 6 go through (grain left ${L.pack.grain}), the rest refused (${(A.since(ev).match(/Slow down/g) ?? []).length} x "Slow down")`);
await sleep(1100);

// 4. The dropper's short delay, then pickup with the weight cap: the remainder stays on the ground.
const wood = (await ground()).find((i) => i.good === "wood");
ev = A.events.length;
A.send({ type: "pickupGround", id: wood.id });
await sleep(100);
result(/just put that down/.test(A.since(ev)) && (await ground()).find((i) => i.id === wood.id)?.qty === 10, `the dropper can't take it straight back (${A.since(ev)})`);
await A.call("fastForward", { ticks: 31 });
await A.call("heroLife", { pack: { rock: 18 } });
ev = A.events.length;
A.send({ type: "pickupGround", id: wood.id });
await sleep(100);
L = await lifeOf(A);
let stack = (await ground()).find((i) => i.id === wood.id);
result(L.pack.wood === 4 && L.pack.rock === 18 && stack?.qty === 6 && /6 left on the ground/.test(A.since(ev)), `pack at 36 / 40 takes 4 of 10 wood, 6 stay (${A.since(ev)})`);
ev = A.events.length;
A.send({ type: "pickupGround", id: wood.id });
await sleep(100);
stack = (await ground()).find((i) => i.id === wood.id);
result(stack?.qty === 6 && /Your pack is full/.test(A.since(ev)), `full pack: refused, the stack stays (${A.since(ev)})`);
// Out of reach.
await A.call("heroLife", { pack: {} });
await stand(A, px(S.x + 3), px(S.y));
ev = A.events.length;
A.send({ type: "pickupGround", id: wood.id });
await sleep(100);
result(/Walk closer/.test(A.since(ev)) && (await ground()).find((i) => i.id === wood.id)?.qty === 6, `3 tiles away: "${A.since(ev)}"`);

// 5. E picks up the nearest stack in reach; another hero takes a stack by clicking it (the message).
await stand(A, px(S.x), px(S.y));
const n0 = (await ground()).length;
ev = A.events.length;
A.send({ type: "interact" });
await sleep(150);
g = await ground();
L = await lifeOf(A);
result(g.length === n0 - 1 && /You pick up/.test(A.since(ev)), `E picks up one stack (${A.since(ev)}; pack ${JSON.stringify(L.pack)})`);
const forB = g[0];
B.send({ type: "pickupGround", id: forB.id });
await sleep(150);
const LB = await lifeOf(B);
result(!(await ground()).some((i) => i.id === forB.id) && (LB.pack[forB.good] ?? 0) === forB.qty, `B picks up A's ${forB.qty} ${forB.good} at once (no dropper delay for others): B's pack ${JSON.stringify(LB.pack)}`);
await A.call("groundItems", { clear: true });

// 6. Gear: drop from the pack; an equipped piece and another hero's item are refused.
await A.call("setEquipment", { armour: [50, 50, 50], weapon: [50, 50, 50] });
for (const tier of [1, 2, 3]) A.send({ type: "takeFromArmoury", slot: "weapon", tier, weaponKind: "sword" });
A.send({ type: "takeFromArmoury", slot: "armour", tier: 2, armourPart: "head" });
await sleep(150);
let inv = await invOf(A);
result(inv.length === 4, `A holds 4 gear items (${inv.map((i) => i.name).join(", ")})`);
const sword1 = inv[0];
const helm = inv[3];
A.send({ type: "equipItem", itemId: helm.id, slot: "head" });
await sleep(100);
ev = A.events.length;
A.send({ type: "dropGear", itemId: helm.id });
let evB = B.events.length;
B.send({ type: "dropGear", itemId: sword1.id });
await sleep(150);
inv = await invOf(A);
result((await ground()).length === 0 && inv.length === 3 && /Unequip that first/.test(A.since(ev)) && /not in your pack/.test(B.since(evB)),
  `refused: the equipped helm (${A.since(ev)}), B dropping A's sword (${B.since(evB)})`);
ev = A.events.length;
A.send({ type: "dropGear", itemId: sword1.id });
await sleep(100);
g = await ground();
inv = await invOf(A);
result(g.length === 1 && g[0].kind === "gear" && g[0].gear.id === sword1.id && inv.length === 2 && !inv.some((i) => i.id === sword1.id),
  `A drops ${sword1.name}: on the ground, out of the pack (${A.since(ev)})`);
await nextSnap(A);
await nextSnap(A);
result(A.ground?.some((s) => s.k === "e" && s.name === sword1.name && s.tier === sword1.tier && s.slot === "weapon"), `snapshot shows the gear stack (${JSON.stringify(A.ground)})`);

// 7. Gear pickup: B's full 40-item pack refuses; A (room) takes it back after the delay.
for (let i = 0; i < 40; i++) B.send({ type: "takeFromArmoury", slot: "armour", tier: 1 });
await sleep(300);
result((await invOf(B)).length === 40, `B's pack is full (${(await invOf(B)).length} items)`);
evB = B.events.length;
B.send({ type: "pickupGround", id: g[0].id });
await sleep(100);
result((await ground()).length === 1 && /pack is full \(40 items\)/.test(B.since(evB)) && (await invOf(B)).length === 40, `B refused: "${B.since(evB)}"`);
await A.call("fastForward", { ticks: 31 });
A.send({ type: "pickupGround", id: g[0].id });
await sleep(100);
inv = await invOf(A);
result((await ground()).length === 0 && inv.some((i) => i.id === sword1.id), `A picks the sword back up (${inv.length} items)`);

// 8. Indoors, dead, no clear ground.
await sleep(1100);
await A.call("heroLife", { pack: { wood: 5 } });
const H = { x: S.x, y: S.y - 2 };
await A.call("setTileRaw", { tx: H.x, ty: H.y, tile: T.House });
const inside = await A.call("interior", { enter: { tx: H.x, ty: H.y } });
ev = A.events.length;
A.send({ type: "dropGood", good: "wood", qty: 1 });
A.send({ type: "dropGear", itemId: sword1.id });
await sleep(150);
result(inside?.why === "" && (await ground()).length === 0 && (await lifeOf(A)).pack.wood === 5 && /indoors/.test(A.since(ev)), `inside a house: refused (${A.since(ev)})`);
await A.call("interior", { exit: true });
await A.call("setTileRaw", { tx: H.x, ty: H.y, tile: T.Empty });
await stand(A, px(S.x), px(S.y));
// The heir rule (not the instant test respawn) keeps the hero lying dead while paused.
await A.call("heroDeath", { legacy: false });
const hit = await A.call("damagePlayer", { amount: 99999 });
A.send({ type: "dropGood", good: "wood", qty: 1 });
A.send({ type: "dropGear", itemId: sword1.id });
await sleep(100);
const deadInv = (await invOf(A)).length;
await A.call("heroDeath", { revive: true, legacy: true });
result(hit?.dead === true && (await ground()).length === 0 && (await lifeOf(A)).pack.wood === 5 && deadInv === 3, `dead: nothing dropped (dead ${hit?.dead}, pack wood ${(await lifeOf(A)).pack.wood}, ${deadInv} items)`);
await stand(A, px(S.x), px(S.y));
for (let y = S.y - 1; y <= S.y + 1; y++) for (let x = S.x - 1; x <= S.x + 1; x++) await A.call("setTileRaw", { tx: x, ty: y, tile: T.Water });
ev = A.events.length;
A.send({ type: "dropGood", good: "wood", qty: 1 });
await sleep(100);
result((await ground()).length === 0 && /No clear ground/.test(A.since(ev)), `surrounded by water: refused (${A.since(ev)})`);
await A.call("setTileRaw", { tx: S.x + 1, ty: S.y, tile: T.Empty });
A.send({ type: "dropGood", good: "wood", qty: 1 });
await sleep(100);
g = await ground();
result(g.length === 1 && g[0].x === px(S.x + 1) && g[0].y === px(S.y), `on water, the stack lands on the dry tile beside (${g[0] && [g[0].x, g[0].y]})`);
for (let y = S.y - 1; y <= S.y + 1; y++) for (let x = S.x - 1; x <= S.x + 1; x++) await A.call("setTileRaw", { tx: x, ty: y, tile: T.Empty });

// 9. Only near stacks are sent, and an unchanged list is not resent.
await A.call("groundItems", { clear: true });
const farX = S.x < W / 2 ? Math.min(W - 2, S.x + 75) : Math.max(1, S.x - 75);
await A.call("groundItems", { spawn: { n: 1, good: "fruit", x: px(farX), y: px(S.y) } });
await A.call("groundItems", { spawn: { n: 1, good: "meat", x: px(S.x + 1), y: px(S.y + 1) } });
await nextSnap(A);
await nextSnap(A);
const sent0 = A.groundMsgs;
for (let i = 0; i < 10; i++) await nextSnap(A);
result(Math.abs(farX - S.x) > 60 ? A.ground?.length === 1 && A.ground[0].good === "meat" : A.ground?.length === 2, `near only: ${JSON.stringify(A.ground?.map((s) => s.good))} (far stack ${Math.abs(farX - S.x)} tiles away)`);
result(A.groundMsgs === sent0, `unchanged list not resent over 10 snapshots (${A.groundMsgs - sent0} resends)`);

// 10. Per-world cap: the oldest goes first.
await A.call("groundItems", { clear: true });
const cap = await A.call("groundItems", { spawn: { n: 300, good: "grain", x: px(S.x + 2), y: px(S.y + 2) } });
const firstId = cap.items[0].id;
A.send({ type: "dropGood", good: "wood", qty: 1 });
await sleep(100);
g = await ground();
result(cap.max === 300 && g.length === 300 && !g.some((i) => i.id === firstId) && g[g.length - 1].good === "wood", `cap ${cap.max}: a drop on a full world evicts the oldest (${firstId} gone, ${g.length} stacks)`);

// 11. Despawn after 3 game days.
await A.call("groundItems", { clear: true });
await sleep(1100);
A.send({ type: "dropGood", good: "wood", qty: 1 });
await sleep(100);
const info = await A.call("groundItems");
let left = info.despawnTicks - 60;
while (left > 0) {
  const n = Math.min(5000, left);
  await A.call("fastForward", { ticks: n });
  left -= n;
}
const mid = (await ground()).length;
await A.call("fastForward", { ticks: 80 });
result(info.despawnTicks === 3 * 7500 && mid === 1 && (await ground()).length === 0, `despawn: still there 60 ticks short of ${info.despawnTicks} (${mid}), gone after`);

// 12. Save / load round trip, then a new world clears the ground.
await A.call("teleportPlayer", { x: px(S.x), y: px(S.y) });
await A.call("heroLife", { pack: { wood: 3, cotton: 2 } });
await sleep(1100);
A.send({ type: "dropGood", good: "wood", qty: 3 });
A.send({ type: "dropGood", good: "cotton", qty: 2 });
const inv2 = await invOf(A);
A.send({ type: "dropGear", itemId: inv2[0].id });
await sleep(150);
const saved = await ground();
A.saves.length = 0;
A.send({ type: "saveGame", slot: "slot1" });
for (let i = 0; i < 1000 && !A.saves.length; i++) await sleep(20);
const sres = A.saves[0];
await A.call("groundItems", { clear: true });
A.saves.length = 0;
const w0 = A.welcomes;
A.send({ type: "loadGame", slot: "slot1" });
for (let i = 0; i < 1500 && !A.saves.length; i++) await sleep(20);
for (let i = 0; i < 500 && A.welcomes === w0; i++) await sleep(20);
await sleep(300);
const loaded = await ground();
const pick = (l) => JSON.stringify(l.map((i) => [i.id, i.kind, i.good, i.qty, i.x, i.y, i.gear?.id, i.gear?.name, i.droppedAtTick, i.dropperKey]));
result(sres?.ok && A.saves[0]?.ok && saved.length === 3 && pick(loaded) === pick(saved), `save / load keeps the 3 stacks (${pick(loaded)})`);
await nextSnap(A);
await nextSnap(A);
await stand(A, px(S.x), px(S.y));
for (let i = 0; i < 5; i++) await nextSnap(A);
result(A.ground?.length === 3, `after the load the client is sent the stacks again (${A.ground?.length})`);
const w1 = A.welcomes;
A.send({ type: "restart", difficulty: "normal" });
for (let i = 0; i < 3000 && A.welcomes === w1; i++) await sleep(20);
await sleep(500);
result((await ground()).length === 0, `a new world has no ground stacks`);

A.ws.close();
B.ws.close();
console.log(fails ? `\n${fails} check(s) FAILED` : "\nAll ground-item checks passed");
process.exit(fails ? 1 : 0);
