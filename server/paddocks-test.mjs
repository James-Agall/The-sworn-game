// Scripted test: Animal paddocks (PLAN-agri-industry-winter-mines.md phase 1; ROADMAP "Animal paddocks — landed").
// An Animal area with a gap in its fence is open; a fence gate closes it (fence 2 wood, gate 4 wood, ordinary build
// tools); a Chicken Coop in the fence line links to it and its hens wander only inside over many ticks; an open Animal
// area keeps the old behaviour (no link, x0.5 feed); grazing in the paddock covers 80% of the feed, overgrazed grass
// covers less and shows bare tiles; the panel's paddock choice; save / load keeps the choice and the grass; a wolf
// goes for the fence, breaks it and the paddock is open again.
// Needs a FRESH private server (80 map, instant build, unlock all): `npm test -- paddocks`.
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
const T = { Empty: 0, Water: 35, Moat: 75, Fence: 45, FenceGate: 146, Coop: 130 };
const TILE = 32;
const px = (t) => t * TILE + 16;

const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, events: [], hook: new Map(), save: null, welcomes: 0, info: null, tiles: [] };
c.ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") {
    c.welcome = m;
    c.welcomes++;
    c.tiles = [...m.tiles];
  } else if (m.type === "snapshot") c.snap = m;
  else if (m.type === "tileUpdate") c.tiles[m.tileY * c.welcome.worldTilesX + m.tileX] = m.tile;
  else if (m.type === "event") c.events.push(m.text);
  else if (m.type === "testHookResult") c.hook.set(m.op, m);
  else if (m.type === "saveResult") c.save = m;
  else if (m.type === "buildingInfo") c.info = m.info;
});
const send = (m) => c.ws.send(JSON.stringify(m));
const hook = async (op, args = {}) => {
  c.hook.delete(op);
  send({ type: "testHook", op, ...args });
  for (let i = 0; i < 3000 && !c.hook.has(op); i++) await sleep(10);
  return c.hook.get(op);
};
const ff = (ticks) => hook("fastForward", { ticks });
const ls = (set) => hook("livestock", set ? { set } : {});
const pads = (set) => hook("paddocks", set ? { set } : {});
const stand = (x, y) => hook("teleportPlayer", { x: px(x), y: px(y) });
const stock = async (s = {}) => (await hook("setStock", { stock: s })).stock;
const eventsSince = (n) => c.events.slice(n).join(" | ");
async function waitEvent(n, ms = 1500) {
  for (let i = 0; i < ms / 10 && c.events.length === n; i++) await sleep(10);
}
async function act(m) {
  const n = c.events.length;
  send({ type: "animalAction", ...m });
  await waitEvent(n);
  return eventsSince(n);
}
async function info(x, y) {
  c.info = null;
  send({ type: "buildingInfo", tileX: x, tileY: y });
  for (let i = 0; i < 300 && !c.info; i++) await sleep(10);
  return c.info;
}
async function place(x, y, tile) {
  send({ type: "setTile", tileX: x, tileY: y, tile });
  for (let i = 0; i < 200 && tileAt(x, y) !== tile; i++) await sleep(10);
}
const raw = (x, y, tile) => hook("setTileRaw", { tx: x, ty: y, tile });
const dayNow = async () => {
  for (let i = 0; i < 30 && (await hook("respawnState")).isNight; i++) await ff(400);
};

while (!c.welcome || !c.snap) await sleep(20);
const W = c.welcome.worldTilesX;
const tileAt = (x, y) => c.tiles[y * W + x];
await hook("setRaids", { enabled: false });
const tc = (await hook("constructionState")).townCenters[0];
const waterNear = (x, y, r) => {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if ([T.Water, T.Moat].includes(tileAt(x + dx, y + dy))) return true;
  return false;
};
// A dry 29 x 12 spot near the Town Center (no water within 9 tiles of either part), cleared. P = the paddock's fence
// ring (x P.x .. P.x+7, y P.y .. P.y+6; inside 6 x 5 = 30 tiles), the open area O (5 x 4) further east, its coop more
// than PADDOCK_LINK_RANGE_TILES (12) from the paddock.
// No NPC site's ground (camps, ruins) in or near it: their fences are not ours.
const owned = new Set((await hook("ownerState")).owners.map((o) => `${o.x},${o.y}`));
const siteNear = (x0, y0) => {
  for (let y = y0 - 6; y <= y0 + 15; y++) for (let x = x0 - 6; x <= x0 + 31; x++) if (owned.has(`${x},${y}`)) return true;
  return false;
};
let P = null;
for (const [dx, dy] of [[4, 4], [-28, 4], [4, -14], [-28, -14], [6, 0], [-30, 0], [-12, 6], [-12, -16], [2, 8], [-26, 8], [2, -18], [-26, -18]]) {
  const x = tc.x + dx;
  const y = tc.y + dy;
  if (x > 3 && y > 3 && x + 27 < W - 3 && y + 10 < W - 3 && !waterNear(x + 3, y + 3, 9) && !waterNear(x + 22, y + 3, 9) && !siteNear(x, y)) {
    P = { x, y };
    break;
  }
}
if (!P) P = { x: tc.x + 4, y: tc.y + 4 };
for (let dy = -2; dy <= 9; dy++) for (let dx = -2; dx <= 26; dx++) send({ type: "testHook", op: "setTileRaw", tx: P.x + dx, ty: P.y + dy, tile: T.Empty });
await raw(P.x, P.y, T.Empty);
await stock({ gold: 2000, grain: 200, wood: 200 });
await hook("ignorePlayers", { value: true });
const inside = (x, y) => x >= P.x + 1 && x <= P.x + 6 && y >= P.y + 1 && y <= P.y + 5;
const interior = [];
for (let y = P.y + 1; y <= P.y + 5; y++) for (let x = P.x + 1; x <= P.x + 6; x++) interior.push(x, y);

// 1. Paint the Animal area (the 30 inside tiles): no fence yet -> open.
await stand(P.x + 3, P.y + 3);
send({ type: "zoneEdit", op: "paint", kind: "animal", tiles: interior });
await sleep(150);
let Z = (await hook("zoneState")).snapshot.zones.find((z) => z.kind === "animal");
let D = await pads({ recheck: true });
let pd = D.paddocks.find((p) => p.zoneId === Z?.id);
result(!!Z && pd && !pd.fenced && /more than 400|map edge|no fence/.test(pd.why), `unfenced Animal area is open: ${pd?.why}`);

// 2. Fence and gate are ordinary build tools: fence 2 wood, gate 4 wood (stand next to them).
const ring = [];
for (let x = P.x; x <= P.x + 7; x++) ring.push([x, P.y], [x, P.y + 6]);
for (let y = P.y + 1; y <= P.y + 5; y++) ring.push([P.x, y], [P.x + 7, y]);
const coop = { x: P.x, y: P.y + 3 };
const gate = { x: P.x + 4, y: P.y + 6 };
let wood0 = (await stock()).wood;
await stand(P.x + 3, P.y - 1);
await place(P.x + 3, P.y, T.Fence);
await place(P.x + 4, P.y, T.Fence);
let wood1 = (await stock()).wood;
result(tileAt(P.x + 3, P.y) === T.Fence && tileAt(P.x + 4, P.y) === T.Fence && wood0 - wood1 === 4, `two fences built with the tool for ${wood0 - wood1} wood`);
for (const [x, y] of ring) {
  if ((x === coop.x && y === coop.y) || (x === gate.x && y === gate.y) || tileAt(x, y) === T.Fence) continue;
  await raw(x, y, T.Fence);
}
// The gate gap is still open: a flood leaks out.
D = await pads({ recheck: true });
pd = D.paddocks.find((p) => p.zoneId === Z.id);
result(!pd.fenced && /more than 400|map edge/.test(pd.why), `fence with a gap is open: ${pd.why}`);

// 3. The gate closes it: fenced, 30 tiles (the coop's tile is still a gap: put the coop in the fence line first).
await stand(coop.x - 1, coop.y);
await place(coop.x, coop.y, T.Coop);
await stand(gate.x, gate.y + 1);
wood0 = (await stock()).wood;
await place(gate.x, gate.y, T.FenceGate);
wood1 = (await stock()).wood;
D = await pads({ recheck: true });
pd = D.paddocks.find((p) => p.zoneId === Z.id);
result(tileAt(gate.x, gate.y) === T.FenceGate && wood0 - wood1 === 4, `fence gate built for ${wood0 - wood1} wood`);
result(pd.fenced && pd.size === 30 && pd.fences >= 20 && !pd.water && pd.tiles.every(([x, y]) => inside(x, y)), `gate closes the fence: fenced ${pd.fenced}, ${pd.size} tiles, ${pd.fences} fence pieces`);
await sleep(600);
Z = (await hook("zoneState")).snapshot.zones.find((z) => z.id === Z.id);
result(Z.paddock?.fenced === true && Z.paddock.size === 30, `zone snapshot: ${JSON.stringify({ fenced: Z.paddock?.fenced, size: Z.paddock?.size, grass: Z.paddock?.grass })}`);

// 4. Three hens (no rooster: no chicks, so the feed sums stay exact) in the coop: the house links to the paddock (exit = the tile next to the coop).
const key = `${coop.x},${coop.y}`;
await ff(2);
for (const male of [false, false, false]) await act({ tileX: coop.x, tileY: coop.y, op: "buy", species: "chicken", male });
let L = await ls({ link: true });
let H = L.houses.find((h) => h.key === key);
result(H?.pen?.id === Z.id && H.pen.size === 30 && H.pen.exit[0] === coop.x + 1 && H.pen.exit[1] === coop.y, `coop linked: ${JSON.stringify(H?.pen)}`);
D = await pads();
result(D.occupancy[Z.id]?.animals === 3 && D.occupancy[Z.id]?.need === 3, `occupancy ${JSON.stringify(D.occupancy[Z.id])}`);
let I = await info(coop.x, coop.y);
result(I?.animals?.paddock?.linked === Z.name && I.animals.paddock.options.some((o) => o.id === Z.id) && I.animals.notes.some((n) => /Paddock/.test(n)), `panel: linked "${I?.animals?.paddock?.linked}", options ${JSON.stringify(I?.animals?.paddock?.options)}`);

// 5. Over many ticks the hens only ever stand inside the paddock (and do move).
await dayNow();
await stand(P.x + 10, P.y + 12);
let samples = 0;
let outside = 0;
const seen = new Set();
for (let k = 0; k < 80; k++) {
  await ff(20);
  L = await ls();
  for (const a of L.animals.filter((a) => a.house === key && a.outdoors)) {
    samples++;
    const tx = Math.floor(a.x / TILE);
    const ty = Math.floor(a.y / TILE);
    seen.add(`${tx},${ty}`);
    if (!inside(tx, ty) || !a.inPen) outside++;
  }
}
result(samples > 50 && outside === 0 && seen.size >= 4, `1600 ticks: ${samples} hen positions outdoors, ${outside} outside the fence, ${seen.size} different tiles`);

// 6. Unfenced behaviour unchanged: a coop by an open Animal area grazes it as before (no paddock, x0.5 feed).
const O = { x: P.x + 20, y: P.y + 1 };
const open = [];
for (let y = O.y; y < O.y + 4; y++) for (let x = O.x; x < O.x + 5; x++) open.push(x, y);
await stand(O.x + 2, O.y + 5);
send({ type: "zoneEdit", op: "paint", kind: "animal", tiles: open });
await sleep(150);
const Zo = (await hook("zoneState")).snapshot.zones.find((z) => z.kind === "animal" && z.id !== Z.id);
const okey = `${O.x + 2},${O.y + 5}`;
await stand(O.x + 2, O.y + 6);
await place(O.x + 2, O.y + 5, T.Coop);
await ff(2);
for (const male of [false, false, false]) await act({ tileX: O.x + 2, tileY: O.y + 5, op: "buy", species: "chicken", male });
D = await pads({ recheck: true });
L = await ls({ link: true });
let Ho = L.houses.find((h) => h.key === okey);
const po = D.paddocks.find((p) => p.zoneId === Zo?.id);
result(!!Zo && !po.fenced && Ho && Ho.pen === null && Ho.graze >= 15, `open area: fenced ${po?.fenced}, house pen ${JSON.stringify(Ho?.pen)}, grazes ${Ho?.graze} tiles`);
let outO = 0;
for (let k = 0; k < 30 && outO === 0; k++) {
  await ff(20);
  outO = (await ls()).animals.filter((a) => a.house === okey && a.outdoors).length;
}
result(outO > 0, `open-area hens come out as before (${outO} outdoors)`);

// 7. Grazing: the daily feed of 3 chickens (1.5): open area x0.5 = 0.75, full paddock x(1 - 0.8) = 0.3.
await ls({ house: key, feed: 50, water: 50 });
await ls({ house: okey, feed: 50, water: 50 });
L = await ls({ daily: true });
H = L.houses.find((h) => h.key === key);
Ho = L.houses.find((h) => h.key === okey);
const usedPaddock = 50 - H.feed;
const usedOpen = 50 - Ho.feed;
result(Math.abs(usedPaddock - 0.3) < 1e-6 && Math.abs(usedOpen - 0.75) < 1e-6, `daily feed: paddock ${usedPaddock.toFixed(3)} (expect 0.3), open area ${usedOpen.toFixed(3)} (expect 0.75)`);
// Overgrazed: grass 0.05 on every tile (total 0.05 x size for a need of 3; 30 tiles: coverage 0.5 -> 1.5 x (1 - 0.4) =
// 0.9); bare tiles. (A tree may regrow on a paddock tile: the size is read back.)
await pads({ zoneId: Z.id, grass: 0.05 });
const size7 = (await pads({ recheck: true })).paddocks.find((p) => p.zoneId === Z.id).size;
const expectBare = 1.5 * (1 - 0.8 * Math.min(1, (0.05 * size7) / 3));
await sleep(600);
Z = (await hook("zoneState")).snapshot.zones.find((z) => z.id === Z.id);
const bareShown = Z.paddock?.bare?.length > 0 && Z.paddock.grass === 5;
await ls({ house: key, feed: 50, water: 50 });
L = await ls({ daily: true });
H = L.houses.find((h) => h.key === key);
const usedBare = 50 - H.feed;
D = await pads();
pd = D.paddocks.find((p) => p.zoneId === Z.id);
result(Math.abs(usedBare - expectBare) < 1e-6 && bareShown, `overgrazed (${size7} tiles): feed ${usedBare.toFixed(3)} (expect ${expectBare.toFixed(3)}), snapshot grass ${Z.paddock?.grass}% with bare tiles ${bareShown}`);
result(pd.grass > 5 && pd.grass < 15, `under-stocked bare grass regrows slowly: ${pd.grass}% after a day`);

// 8. The panel's choice: "none" unlinks (open-area behaviour), auto links again.
let r = await act({ tileX: coop.x, tileY: coop.y, op: "paddock", zoneId: -1 });
L = await ls();
const unlinked = L.houses.find((h) => h.key === key).pen === null;
r += " / " + (await act({ tileX: coop.x, tileY: coop.y, op: "paddock", zoneId: Z.id }));
L = await ls();
H = L.houses.find((h) => h.key === key);
result(unlinked && H.pen?.id === Z.id && H.paddockChoice === Z.id, `choice: ${r}`);

// 9. Save / load keeps the paddock, the house's choice and the grass.
await pads({ zoneId: Z.id, grass: 0.5 });
const savedHens = (await ls()).animals.filter((a) => a.house === key).length;
const savedSize = (await pads({ recheck: true })).paddocks.find((p) => p.zoneId === Z.id).size;
c.save = null;
send({ type: "saveGame", slot: "slot1" });
for (let i = 0; i < 300 && !c.save; i++) await sleep(10);
result(c.save?.ok === true, `saved (${c.save?.error ?? "ok"})`);
await act({ tileX: coop.x, tileY: coop.y, op: "paddock", zoneId: null });
await pads({ zoneId: Z.id, grass: 1 });
c.save = null;
const w0 = c.welcomes;
send({ type: "loadGame", slot: "slot1" });
for (let i = 0; i < 300 && (!c.save || c.welcomes === w0); i++) await sleep(10);
await sleep(200);
D = await pads({ recheck: true });
pd = D.paddocks.find((p) => p.zoneId === Z.id);
L = await ls({ link: true });
H = L.houses.find((h) => h.key === key);
result(pd?.fenced && pd.size === savedSize && pd.grass === 50 && H?.paddockChoice === Z.id && H.pen?.id === Z.id && L.animals.filter((a) => a.house === key).length === savedHens,
  `loaded: paddock fenced ${pd?.fenced} ${pd?.size} tiles, grass ${pd?.grass}%, choice ${H?.paddockChoice}, pen ${H?.pen?.id}, animals ${L.animals.filter((a) => a.house === key).length}/${savedHens}`);

// 10. A wolf outside goes for the fence (not the hens inside), breaks it, and the paddock is open again.
await pads({ zoneId: Z.id, grass: 1 });
await ls({ threat: false });
await dayNow();
await stand(P.x + 10, P.y + 14);
const before = (await ls()).animals.filter((a) => a.house === key).length;
let n = c.events.length;
// The predator pick from 3 tiles north of the fence: the fence piece straight south, attacked from outside.
const probe = (await pads({ probe: [px(P.x + 3), px(P.y - 3)] })).probe;
result(probe?.x === P.x + 3 && probe.y === P.y && probe.approach.x === P.x + 3 && probe.approach.y === P.y - 1, `predator pick: ${JSON.stringify(probe)}`);
// (No random Hunger mark: a marked wolf hunts by its own rules.)
await hook("forceMarkChance", { value: 0 });
const wolf = (await hook("spawnMob", { kind: "wolf", tx: P.x + 3, ty: P.y - 3 })).id;
let target = null;
let broken = null;
for (let k = 0; k < 150 && !broken; k++) {
  await ff(20);
  const m = (await hook("bodyState")).mobs.find((q) => q.id === wolf);
  if (m?.targetType === "building" && !target) target = m.targetId;
  for (const [x, y] of ring) if (tileAt(x, y) === T.Empty) broken = `${x},${y}`;
}
const afterBreak = (await ls()).animals.filter((a) => a.house === key).length;
const tgt = target ? target.split(",").map(Number) : null;
const fenceTarget = !!tgt && ring.some(([x, y]) => x === tgt[0] && y === tgt[1]);
D = await pads({ recheck: true });
pd = D.paddocks.find((p) => p.zoneId === Z.id);
result(fenceTarget && !!broken && /Fence destroyed/.test(eventsSince(n)) && afterBreak === before, `wolf targeted ${target} (fence ${fenceTarget}), broke ${broken}; hens ${before} -> ${afterBreak} (${eventsSince(n).slice(0, 160)})`);
result(!pd.fenced, `paddock open again after the break: ${pd.why}`);
L = await ls({ link: true });
result(L.houses.find((h) => h.key === key).pen === null, `the coop is no longer linked to a paddock`);
if (wolf) await hook("damageMob", { mobId: wolf, amount: 99999 });

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
