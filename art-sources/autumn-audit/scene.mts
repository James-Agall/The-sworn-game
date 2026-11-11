// In-game sprite audit scene. Private server + vite dev on private ports; the page's ws://localhost:8080 socket is
// routed (page.routeWebSocket) to our private server, so nothing ever reaches :8080.
// usage: tsx scene.mts <label> [only-phase]
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { TileType } from "/home/james/projects/colony2d/shared/src/protocol.ts";

const S = "/tmp/claude-1000/-home-james/fda938bb-ce41-48e7-b6b6-722452e2fc49/scratchpad";
const label = process.argv[2] ?? "run";
const only = process.argv[3];
const repo = "/home/james/projects/colony2d";
const { chromium } = createRequire("/home/james/projects/auto-loan-ff-release/package.json")("playwright");
const WS = createRequire(repo + "/server/package.json")("ws");
const free = () => new Promise<number>((r) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as any).port; s.close(() => r(p)); }); });
const gamePort = await free(), webPort = await free();
if (gamePort === 8080 || webPort === 8080) throw new Error("port clash");
const save = mkdtempSync(S + "/save-");
const out = `${S}/shots/${label}`;
mkdirSync(out, { recursive: true });
const server = spawn(repo + "/node_modules/.bin/tsx", ["src/index.ts"], { cwd: repo + "/server", env: { ...process.env, PORT: String(gamePort), COLONY_SAVE_DIR: save, COLONY_TEST_HOOKS: "1", COLONY_UNLOCK_ALL: "1", COLONY_WORLD_SEED: "20261110" }, stdio: ["ignore", "pipe", "pipe"] });
const vite = spawn(process.execPath, [repo + "/node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"], { cwd: repo + "/client", stdio: ["ignore", "pipe", "pipe"] });
let logs = "";
for (const p of [server, vite]) { p.stdout!.on("data", (b) => (logs += b)); p.stderr!.on("data", (b) => (logs += b)); }
console.log("pids", server.pid, vite.pid, "ports", gamePort, webPort);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let browser: any;
let upstream: any;
let snap: any = null, welcome: any = null;
const hookWaiters: ((m: any) => void)[] = [];
let patchMounted = false;
try {
  for (let i = 0; i < 120; i++) { try { await fetch(`http://127.0.0.1:${webPort}`); break; } catch { await sleep(250); } }
  for (let i = 0; i < 120 && !/listening|Listening|port/i.test(logs); i++) await sleep(250);
  browser = await chromium.launch({ headless: true, executablePath: "/home/james/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors: string[] = [];
  (globalThis as any).__errs = errors;
  const failed: string[] = [];
  page.on("pageerror", (e: any) => errors.push(String(e)));
  page.on("console", (m: any) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("response", (r: any) => { if (r.url().includes("/sprites/") && r.status() >= 400) failed.push(r.url()); });
  await page.routeWebSocket(/localhost:8080/, (ws: any) => {
    const url = new URL(ws.url());
    upstream = new WS(`ws://127.0.0.1:${gamePort}${url.pathname}${url.search}`);
    const pending: any[] = [];
    upstream.on("open", () => { for (const m of pending.splice(0)) upstream.send(m); });
    ws.onMessage((m: any) => (upstream.readyState === 1 ? upstream.send(m) : pending.push(m)));
    upstream.on("message", (data: any, isBinary: boolean) => {
      if (isBinary) { ws.send(data); return; }
      let text = data.toString();
      try {
        const m = JSON.parse(text);
        if (m.type === "welcome") welcome = m;
        if (m.type === "snapshot") { snap = m; if (patchMounted && m.players) { for (const p of m.players) p.mounted = true; text = JSON.stringify(m); } }
        if (m.type === "testHookResult") { const w = hookWaiters.shift(); w?.(m); return; }
      } catch {}
      ws.send(text);
    });
    ws.onClose(() => upstream.close());
  });
  const hook = (op: string, extra: Record<string, unknown> = {}) => new Promise<any>((r) => { hookWaiters.push(r); upstream.send(JSON.stringify({ type: "testHook", op, ...extra })); setTimeout(() => r(null), 4000); });
  let sent = 0;
  const queue: string[] = [];
  const send = (m: Record<string, unknown>) => { queue.push(JSON.stringify(m)); };
  const flush = async () => { while (queue.length) { for (const m of queue.splice(0, 25)) upstream.send(m); sent++; await sleep(120); } };
  await page.goto(`http://127.0.0.1:${webPort}/?mode=creative&delta=0`);
  await page.locator("#menu-creative").click();
  for (let i = 0; i < 480 && !(welcome && snap); i++) await sleep(250);
  if (!snap) throw new Error("no snapshot");
  await sleep(3000);
  const me = () => snap.players?.[0];
  const p0 = me();
  const T = 32;
  const bx = Math.floor(p0.x / T) + 6, by = Math.floor(p0.y / T) - 30;
  console.log("player", p0.x, p0.y, "base", bx, by);
  await hook("setInstantBuild", { enabled: true });
  const set = (tx: number, ty: number, tile: number) => hook("setTileRaw", { tx, ty, tile });
  // clear area
  const W = 60, H = 70;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) send({ type: "testHook", op: "setTileRaw", tx: bx + x, ty: by + y, tile: TileType.Empty });
  await flush();
  await sleep(1500);
  hookWaiters.length = 0;
  await page.addStyleTag({ content: "body * { visibility: hidden !important; } canvas { visibility: visible !important; }" });
  const shot = async (name: string, zoomNotches = 0) => {
    await page.mouse.move(700, 450);
    if (zoomNotches) for (let i = 0; i < Math.abs(zoomNotches); i++) { await page.mouse.wheel(0, zoomNotches > 0 ? -100 : 100); await sleep(120); }
    await sleep(900);
    await page.screenshot({ path: `${out}/${name}.png`, timeout: 60000 });
    if (zoomNotches) for (let i = 0; i < Math.abs(zoomNotches); i++) { await page.mouse.wheel(0, zoomNotches > 0 ? 100 : -100); await sleep(120); }
  };
  const go = async (tx: number, ty: number) => { await hook("teleportPlayer", { x: tx * T + 16, y: ty * T + 16 }); await sleep(1500); };
  const fill = (tiles: number[], x0: number, y0: number, step: number, perRow: number) => {
    tiles.forEach((t, i) => send({ type: "testHook", op: "setTileRaw", tx: x0 + (i % perRow) * step, ty: y0 + Math.floor(i / perRow) * step, tile: t }));
  };
  // ---- A: buildings ----
  const B = TileType as any;
  const buildings = ["TownCenter", "House", "BigHouse", "HouseLevel2", "Tavern", "ChurchPost", "AbbeyHall", "Market", "GoldShop", "LumberjackPost", "IronMinePost", "RockMinePost", "Blacksmith", "Bakery", "Mill", "TailorShop", "Brewery", "KnightPost", "MilitiaPost", "MilitiaCamp2", "MilitiaCamp3", "ArcherPost", "Tower", "ArcherTower", "Keep", "CastleLevel2", "CastleLevel3", "Stables", "SiegeWorkshop", "HunterHut", "ForagerHut", "BuildersGuild", "LuxuryWorkshop", "ChickenCoop", "LivestockBarn", "PigSty", "SheepPen", "Pasture", "WoolFarm", "PigPasture", "Orchard", "CottonFarm", "FarmPlot", "BarnPost", "Tent", "CharcoalBurner", "Bloomery", "WardStone", "SiteKeep", "RuinedKeep"].filter((n) => B[n] !== undefined).map((n) => B[n]);
  fill(buildings, bx + 2, by + 3, 5, 10);
  // ---- B: props / nature ----
  const props = ["PropCampfire", "PropCart", "PropBarrel", "PropCrate", "PropFence", "PropCross", "PropLanternPost", "RuinWall1", "RuinWall2", "RuinArch", "RuinStatue", "RuinRubble", "Tree", "Rock", "IronOre", "BerryBush", "BerryBushPicked", "FruitTree", "FruitTreePicked", "MushroomPatch", "MushroomPatchPicked", "Water", "Rubble"].filter((n) => B[n] !== undefined).map((n) => B[n]);
  fill(props, bx + 2, by + 30, 2, 12);
  // ---- C: walls / gates / moat / roads ----
  const cx = bx + 2, cy = by + 37;
  for (let i = 0; i < 9; i++) { send({ type: "testHook", op: "setTileRaw", tx: cx + i, ty: cy, tile: B.Wall }); send({ type: "testHook", op: "setTileRaw", tx: cx + i, ty: cy + 6, tile: B.Wall }); }
  for (let j = 0; j < 7; j++) { send({ type: "testHook", op: "setTileRaw", tx: cx, ty: cy + j, tile: B.Wall }); send({ type: "testHook", op: "setTileRaw", tx: cx + 8, ty: cy + j, tile: B.Wall }); }
  send({ type: "testHook", op: "setTileRaw", tx: cx + 4, ty: cy + 6, tile: B.Gate });
  send({ type: "testHook", op: "setTileRaw", tx: cx + 4, ty: cy + 3, tile: B.Wall });
  const sx = bx + 14;
  for (let i = 0; i < 9; i++) { send({ type: "testHook", op: "setTileRaw", tx: sx + i, ty: cy, tile: B.StoneWall }); send({ type: "testHook", op: "setTileRaw", tx: sx + i, ty: cy + 6, tile: B.StoneWall }); }
  for (let j = 0; j < 7; j++) { send({ type: "testHook", op: "setTileRaw", tx: sx, ty: cy + j, tile: B.StoneWall }); send({ type: "testHook", op: "setTileRaw", tx: sx + 8, ty: cy + j, tile: B.StoneWall }); }
  send({ type: "testHook", op: "setTileRaw", tx: sx + 8, ty: cy + 3, tile: B.Gate });
  for (let i = -1; i < 10; i++) { send({ type: "testHook", op: "setTileRaw", tx: sx + i, ty: cy + 8, tile: B.Moat }); }
  for (let j = 0; j < 9; j++) send({ type: "testHook", op: "setTileRaw", tx: sx + 10, ty: cy + j, tile: B.Moat });
  send({ type: "testHook", op: "setTileRaw", tx: sx + 4, ty: cy + 8, tile: B.Drawbridge });
  // roads: a loop + cross + T, dirt and cobble
  const rx = bx + 28;
  for (let i = 0; i < 8; i++) { send({ type: "testHook", op: "setTileRaw", tx: rx + i, ty: cy, tile: B.Road }); send({ type: "testHook", op: "setTileRaw", tx: rx + i, ty: cy + 5, tile: B.Road }); }
  for (let j = 0; j < 6; j++) { send({ type: "testHook", op: "setTileRaw", tx: rx, ty: cy + j, tile: B.Road }); send({ type: "testHook", op: "setTileRaw", tx: rx + 7, ty: cy + j, tile: B.Road }); send({ type: "testHook", op: "setTileRaw", tx: rx + 3, ty: cy + j, tile: B.Road }); }
  send({ type: "testHook", op: "setTileRaw", tx: rx + 10, ty: cy + 2, tile: B.Road });
  for (let i = 0; i < 7; i++) { send({ type: "testHook", op: "setTileRaw", tx: rx + 12 + i, ty: cy + 3, tile: B.CobbleRoad }); send({ type: "testHook", op: "setTileRaw", tx: rx + 15, ty: cy + i, tile: B.CobbleRoad }); }
  // ---- D: room with furniture ----
  const fx = bx + 2, fy = by + 50;
  for (let y = 0; y < 7; y++) for (let x = 0; x < 11; x++) {
    const edge = x === 0 || y === 0 || x === 10 || y === 6;
    send({ type: "testHook", op: "setTileRaw", tx: fx + x, ty: fy + y, tile: edge ? B.Wall : B.WoodFloor });
  }
  send({ type: "testHook", op: "setTileRaw", tx: fx + 5, ty: fy + 6, tile: B.WoodDoor });
  send({ type: "testHook", op: "setTileRaw", tx: fx + 2, ty: fy, tile: B.WoodWindow });
  send({ type: "testHook", op: "setTileRaw", tx: fx + 10, ty: fy + 3, tile: B.WoodWindow });
  ["Bed", "Table", "Chair", "Chest", "Shelf", "Hearth", "Lamp", "Rug", "Workbench", "Statue", "WeaponRack", "Wardrobe", "MedicineChest"].forEach((n, i) => send({ type: "testHook", op: "setTileRaw", tx: fx + 1 + (i % 9), ty: fy + 1 + 2 * Math.floor(i / 9), tile: B[n] }));
  const gx = bx + 16;
  for (let y = 0; y < 7; y++) for (let x = 0; x < 11; x++) {
    const edge = x === 0 || y === 0 || x === 10 || y === 6;
    send({ type: "testHook", op: "setTileRaw", tx: gx + x, ty: fy + y, tile: edge ? B.StoneWall : B.StoneFloor });
  }
  send({ type: "testHook", op: "setTileRaw", tx: gx + 5, ty: fy + 6, tile: B.StoneDoor });
  send({ type: "testHook", op: "setTileRaw", tx: gx + 0, ty: fy + 3, tile: B.StoneDoor });
  send({ type: "testHook", op: "setTileRaw", tx: gx + 3, ty: fy, tile: B.StoneWindow });
  await flush();
  await sleep(2500);
  // ---- hero close-ups (empty cleared corner) ----
  if (only === "hero") {
    await go(Math.floor(p0.x / T) + 2, Math.floor(p0.y / T) + 4);
    const crop = async (name: string) => { await sleep(700); await page.screenshot({ path: `${out}/${name}.png`, clip: { x: 500, y: 250, width: 400, height: 400 } }); };
    for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, -100); await sleep(80); }
    await crop("hero-idle");
    for (const [i, k] of ["d", "a", "s", "w"].entries()) { await page.keyboard.down(k); for (let f = 0; f < 3; f++) { await sleep(170); await page.screenshot({ path: `${out}/hero-walk-${k}${f}.png`, clip: { x: 550, y: 300, width: 300, height: 300 } }); } await page.keyboard.up(k); }
    await page.keyboard.press("Space"); for (let f = 0; f < 3; f++) { await sleep(150); await page.screenshot({ path: `${out}/hero-attack${f}.png`, clip: { x: 550, y: 300, width: 300, height: 300 } }); }
    patchMounted = true; await sleep(800); await crop("hero-mounted");
    await page.keyboard.down("d"); for (let f = 0; f < 3; f++) { await sleep(170); await page.screenshot({ path: `${out}/hero-mounted-walk${f}.png`, clip: { x: 550, y: 300, width: 300, height: 300 } }); } await page.keyboard.up("d");
    patchMounted = false;
    throw new Error("hero done");
  }
  // ---- E: units ----
  const ux = (bx + 34) * T, uy = (by + 50) * T;
  const own = ["militia", "archer", "spearman", "pikeman", "knight", "cavalry"];
  for (let gear = 0; gear <= 3; gear++) own.forEach((kind, i) => send({ type: "creativeSpawn", side: "neutral", kind, count: 1, x: ux + i * 48, y: uy + gear * 48, formation: "none", level: 1, gear, stance: "defensive" }));
  ["farmer", "farmhand", "lumberjack", "ironMiner", "rockMiner", "builder", "hunter", "forager", "artisan", "bishop", "villager"].forEach((kind, i) => send({ type: "creativeSpawn", side: "neutral", kind, count: 1, x: ux + i * 40, y: uy + 4 * 48 + 20, formation: "none" }));
  ["champion", "marksman", "mage"].forEach((heroClass, i) => send({ type: "creativeSpawn", side: "neutral", kind: "hero", heroClass, count: 1, x: ux + (7 + i) * 48, y: uy, formation: "none" }));
  ["batteringRam", "catapult"].forEach((kind, i) => send({ type: "creativeSpawn", side: "neutral", kind, count: 1, x: ux + (7 + i) * 60, y: uy + 2 * 48, formation: "none" }));
  // mobs: folk (passive) settlement kinds + enemies far from the player
  const folk = ["townGuard", "townArcher", "townKnight", "townFarmer", "townMiner", "townPriest", "townHerald"];
  folk.forEach((kind, i) => send({ type: "creativeSpawn", side: "folk", kind, count: 1, x: ux + i * 40, y: uy + 6 * 48, formation: "none" }));
  const mobsK = ["goblin", "goblinCrossbow", "orc", "armoredOrc", "skeleton", "darkShaman", "giantSpider", "troll", "ogre", "banditClubman", "banditArcher", "banditElite", "halfLatch", "goblinRider", "wolf", "batteringRam", "catapult"];
  const mx = (bx + 34) * T, my = (by + 3) * T;
  mobsK.forEach((kind, i) => send({ type: "creativeSpawn", side: "enemy", kind, count: 1, x: mx + (i % 9) * 56, y: my + Math.floor(i / 9) * 70, formation: "none", aggressive: false }));
  for (const [i, kind] of ["deer", "rabbit", "boar", "pheasant", "deer", "boar"].entries()) send({ type: "testHook", op: "spawnWildlife", kind, tx: bx + 34 + i * 2, ty: by + 9 });
  await flush();
  hookWaiters.length = 0;
  await sleep(2500);
  // ---- shots ----
  const scenes: [string, number, number][] = [
    ["mobs", bx + 39, by + 6],
    ["buildings-a", bx + 12, by + 7], ["buildings-b", bx + 37, by + 7], ["buildings-c", bx + 12, by + 20], ["buildings-d", bx + 37, by + 20],
    ["props", bx + 14, by + 31], ["walls", bx + 12, by + 40], ["roads-moat", bx + 32, by + 40],
    ["rooms", bx + 13, by + 53], ["units", bx + 40, by + 54]
  ];
  for (const [name, tx, ty] of scenes) {
    if (only && !name.startsWith(only)) continue;
    await go(tx, ty);
    await shot(name);
    await shot(name + "-zin", 6);
  }
  await shot("zout", -4);
  // mounted hero (renderer only: snapshots patched)
  await go(bx + 40, by + 54);
  patchMounted = true; await sleep(800); await shot("mounted", 8); patchMounted = false; await sleep(500);
  // walking hero frames
  await page.keyboard.down("d"); await sleep(300); await shot("hero-walk", 8); await page.keyboard.up("d");
  // seasons / weather
  for (const [season, weather] of [[3, "snow"], [2, "rain"]] as [number, string][]) {
    await hook("calendar", { set: { season, day: 3 }, weather, update: true });
    await sleep(1500);
    await go(bx + 14, by + 31);
    await shot(`season-${season}-${weather}`);
  }
  await page.screenshot({ path: `${out}/page.png` });
  console.log(JSON.stringify({ errors: errors.slice(0, 20), failed: failed.slice(0, 50) }));
} catch (e) {
  console.error("FAIL", String(e).slice(0, 300));
  console.error("PAGEERR", JSON.stringify(globalThis.__errs ?? []).slice(0, 3000));
  console.error(logs.slice(-3000));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  vite.kill("SIGTERM");
}
