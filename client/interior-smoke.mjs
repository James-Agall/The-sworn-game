#!/usr/bin/env node
// Interior fixes 2026-11-27: browser check of a HOSTILE interior (a cave entered through the test hooks). Not part of
// `npm test` (needs Playwright + a Chromium from outside the repo, like client/hotbar-smoke.mjs, whose harness it reuses).
//
//   node client/interior-smoke.mjs --out <scratch dir> [--port 31990] [--no-build]
//
// Checks inside the cave: the hotbar shows (two rows); the tool slots are dimmed with "Not usable in here" and 1-9 arm
// nothing; Shift+5 / Shift+6 / 0 / a click wield weapons; Space sends a combat attack with no tool in hand; spell
// slots show, Shift+2 (Thunder, ground) aims and a click in the interior view casts at interior coordinates near the
// clicked point (the server lands it: spell event), Shift+1 twice heals, the cooldown overlay shows, F1 on cooldown
// toasts; Esc while aiming closes only the aim (still inside, weapon kept); a dropped stack is drawn inside the room
// with "E: pick up", E picks it up; layout at 1280x800 and 1024x720 (no overlap with the interior HUD, the use hint,
// the hero bar, the adventure tracker); a peaceful house hides the hotbar; no page errors. Screenshots in <out>.
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, createReadStream, statSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const OUT = path.resolve(arg("out", mkdtempSync(path.join(os.tmpdir(), "interior-smoke-"))));
const PORT = Number(arg("port", "31990"));
const WEB_PORT = PORT + 1;
const SKIP_BUILD = args.includes("--no-build");
const PW_FROM = process.env.PW_MODULE_FROM ?? "/home/james/projects/auto-loan-ff-release/package.json";
const CHROME = process.env.PW_CHROME ??
  "/tmp/claude-1000/-home-james/e750a2dc-86fa-43ba-992d-dfa7a0e3a701/scratchpad/pw-browsers/chromium-1234/chrome-linux64/chrome";
if ([8080, 5173, 5175].includes(PORT) || [8080, 5173, 5175].includes(WEB_PORT)) throw new Error("reserved port");
mkdirSync(OUT, { recursive: true });

const portFree = (p) => new Promise((res) => { const s = net.createServer(); s.once("error", () => res(false)); s.listen(p, () => s.close(() => res(true))); });
for (const p of [PORT, WEB_PORT]) if (!(await portFree(p))) throw new Error(`port ${p} busy`);

const DIST = path.join(OUT, "dist");
if (!SKIP_BUILD) {
  execFileSync(path.join(ROOT, "node_modules/.bin/vite"), ["build", "--outDir", DIST, "--emptyOutDir", "--logLevel", "warn"], {
    cwd: path.join(ROOT, "client"), stdio: "inherit", env: { ...process.env, VITE_SERVER_URL: `ws://localhost:${PORT}` },
  });
}

// --- private server -------------------------------------------------------------------------------------------
const saveDir = mkdtempSync(path.join(os.tmpdir(), "interior-smoke-saves-"));
const tsx = [path.join(ROOT, "server/node_modules/.bin/tsx"), path.join(ROOT, "node_modules/.bin/tsx")].find((p) => existsSync(p));
const server = spawn(tsx, [path.join(ROOT, "server/src/index.ts")], {
  cwd: path.join(ROOT, "server"),
  env: { ...process.env, PORT: String(PORT), COLONY_SAVE_DIR: saveDir, COLONY_TEST_HOOKS: "1", COLONY_WORLD_SIZE: "160", COLONY_WORLD_SEED: "42", COLONY_HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"], detached: true,
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error("server did not start\n" + serverLog)), 120000);
  const iv = setInterval(() => { if (serverLog.includes("listening")) { clearTimeout(t); clearInterval(iv); res(); } }, 200);
});

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".svg": "image/svg+xml", ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".webp": "image/webp", ".woff2": "font/woff2" };
const web = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const file = path.join(DIST, url === "/" ? "index.html" : url);
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => web.listen(WEB_PORT, "127.0.0.1", r));
const cleanup = () => {
  try { process.kill(-server.pid, "SIGKILL"); } catch {}
  try { web.close(); } catch {}
};
process.on("exit", cleanup);

// --- browser ----------------------------------------------------------------------------------------------------
const { chromium } = createRequire(PW_FROM)("playwright");
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(`[${globalThis.__step ?? ""}] ` + String(e.stack ?? e.message).slice(0, 300)));
await page.addInitScript(() => {
  try { localStorage.setItem("sworn.mapSize", "160"); } catch {}
  const Native = window.WebSocket;
  window.__sent = [];
  window.__recv = { tileUpdates: [] };
  window.WebSocket = class extends Native {
    constructor(...a) {
      super(...a);
      window.__ws = this;
      const send = this.send.bind(this);
      this.send = (data) => {
        try { const m = JSON.parse(data); if (m.type !== "input" && m.type !== "viewport" && m.type !== "requestChunks") window.__sent.push(m); } catch {}
        return send(data);
      };
      this.addEventListener("message", (ev) => {
        if (typeof ev.data !== "string") return;
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.type === "tileUpdate") window.__recv.tileUpdates.push([m.tileX, m.tileY, m.tile]);
        if (m.type === "testHookResult") window.__recv["hook_" + m.op] = m;
      });
    }
  };
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (ok, what) => { results.push({ ok: !!ok, what }); console.log(`${ok ? "PASS" : "FAIL"} ${what}`); };
const send = (msg) => page.evaluate((m) => window.__ws.send(JSON.stringify(m)), msg);
const hook = async (op, extra = {}) => {
  await page.evaluate((op) => { delete window.__recv["hook_" + op]; }, op);
  await send({ type: "testHook", op, ...extra });
  await page.waitForFunction((op) => window.__recv["hook_" + op], op, { timeout: 15000 });
  return page.evaluate((op) => window.__recv["hook_" + op], op);
};
const mark = () => page.evaluate(() => window.__sent.length);
// Game messages sent since mark n (the test hook polls are left out).
const sentSince = (n) => page.evaluate((n) => window.__sent.slice(n).filter((m) => m.type !== "testHook"), n);
const esc = async () => { await page.keyboard.press("Escape"); await sleep(250); };
const hero = async () => (await hook("heroState")).profile;
const until = async (pred, ms = 5000) => { const t = Date.now(); let p; while (Date.now() - t < ms) { p = await hero(); if (pred(p)) return p; await sleep(150); } return p; };
const waitUi = async (pred, ms = 4000) => { const t = Date.now(); let s; while (Date.now() - t < ms) { s = await ui(); if (pred(s)) return s; await sleep(100); } return s; };
const toasts = () => page.evaluate(() => [...document.querySelectorAll(".event-toast")].map((t) => t.textContent).join(" | "));
// The hotbar as drawn: weapon slots (aria labels, lit, dimmed, hotkey label), tool slots lit, spell buttons shown.
const ui = () => page.evaluate(() => {
  const vis = (e) => !!e && e.checkVisibility();
  const ws = [...document.querySelectorAll("#hero-hotbar .hh-weapons .hh-slot:not(.hh-ph)")];
  const ph = [...document.querySelectorAll("#hero-hotbar .hh-weapons .hh-slot.hh-ph")];
  const top = document.querySelector("#hero-hotbar > .hh-top"), bottom = document.querySelector("#hero-hotbar > .hh-bottom");
  const sb = document.getElementById("spell-bar");
  return {
    weapons: ws.map((s) => ({ label: s.getAttribute("aria-label"), on: s.classList.contains("on"), none: s.classList.contains("none"), kbd: s.querySelector("kbd")?.textContent ?? "", focusable: s.tabIndex === 0 })),
    toolOn: [...document.querySelectorAll("#hero-hotbar .hh-tools .hh-slot.on")].length,
    weaponPh: ph.map((s) => ({ kbd: s.querySelector("kbd")?.textContent ?? "", title: s.title, focusable: s.tabIndex >= 0, shown: vis(s) })),
    // Structure: root children order, what each row holds.
    order: [...document.getElementById("hero-hotbar").children].map((c) => c.className),
    topShown: vis(top), bottomShown: vis(bottom),
    topHasWeapons: !!top?.querySelector(".hh-weapons"), topHasSpells: !!top?.querySelector("#spell-bar"),
    bottomTools: bottom ? bottom.querySelectorAll(".hh-tools .hh-slot").length : 0,
    bottomHasOther: !!bottom?.querySelector(".hh-weapons, #spell-bar"),
    buildTool: document.querySelector("#toolbar .tool-btn.selected")?.textContent?.trim() ?? null,
    spellBarInHotbar: !!sb?.closest("#hero-hotbar .hh-slots"),
    spellBarVisible: vis(sb),
    spellBtns: [...document.querySelectorAll(".spell-btn")].map((b) => ({ inHotbar: !!b.closest("#hero-hotbar"), shown: vis(b), label: b.getAttribute("aria-label"), disabled: b.disabled, title: b.title, kbd: b.querySelector("kbd")?.textContent ?? "", aiming: b.classList.contains("aiming"), cd: b.querySelector(".spell-cd")?.style.height ?? "" })),
    cursor: document.querySelector("canvas")?.style.cursor ?? "",
  };
});
// Learnt spells shown (unlearnt slots are disabled placeholders).
const shownSpells = (s) => s.spellBtns.filter((b) => b.shown && !b.disabled);
const spellPh = (s) => s.spellBtns.filter((b) => b.shown && b.disabled);
const twoRows = (s) => s.topShown && s.bottomShown && s.topHasWeapons && s.topHasSpells && s.bottomTools === 9 && !s.bottomHasOther &&
  JSON.stringify(s.order) === JSON.stringify(["hh-hint", "hh-slots hh-top", "hh-slots hh-bottom", "hh-energy"]);
const rect = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || !e.checkVisibility()) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }, sel);
const overlap = (a, b) => !!a && !!b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
// Click the i-th weapon slot.
const clickWeapon = async (i) => { await page.locator("#hero-hotbar .hh-weapons .hh-slot").nth(i).click(); await sleep(300); };
// Weapon slots follow the client's order: id order of (wielded + pack) player weapons.
const order = (p) => [p.equipment.weapon, ...p.inventory].filter((i) => i && i.slot === "weapon" && ["sword", "axe", "spear", "bow"].includes(i.kind)).sort((a, b) => (a.id < b.id ? -1 : 1));


const TILE = 32;
await page.goto(`http://127.0.0.1:${WEB_PORT}/?mode=creative`);
await page.getByRole("button", { name: "New Game (Creative)" }).or(page.locator("#menu-creative")).first().click();
await page.waitForFunction(() => window.__ws && window.__ws.readyState === 1, null, { timeout: 120000 });
await page.waitForFunction(() => { const l = document.getElementById("loading-screen"); const t = document.body.innerText; return (!l || l.hidden || getComputedStyle(l).display === "none") && !/Forging a new world/.test(t); }, null, { timeout: 180000 });
await sleep(4000);
await page.mouse.move(640, 300);
await hook("setRaids", { enabled: false });
await hook("heroLife", { needs: false, pack: {} });
await hook("setEquipment", { armour: [0, 0, 0], weapon: [0, 0, 2] });
await send({ type: "takeFromArmoury", slot: "weapon", tier: 3, weaponKind: "spear" });
for (const spellId of ["heal", "thunder", "fireBolt"]) await hook("grantSpell", { spellId });
await sleep(600);

// A cave entrance and a house near the Town Center (raw tiles), then in through the hook.
const tc = (await hook("constructionState")).townCenters[0];
const W = 160;
const dir = tc.x < W / 2 ? 1 : -1;
const CAVE = { x: tc.x + dir * 12, y: tc.y }, HOUSE = { x: tc.x + dir * 6, y: tc.y + 7 };
for (const [s, tile] of [[CAVE, 175], [HOUSE, 13]]) {
  for (let dy = -1; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) await hook("setTileRaw", { tx: s.x + dx, ty: s.y + dy, tile: 0 });
  await hook("setTileRaw", { tx: s.x, ty: s.y, tile });
}
await hook("teleportPlayer", { x: (CAVE.x + 0.5) * TILE, y: (CAVE.y + 1.5) * TILE });
let I = await hook("interior", { enter: { tx: CAVE.x, ty: CAVE.y } });
globalThis.__step = "enter";
check(I.why === "" && I.inside, `entered the cave (${I.why || I.view?.title})`);
const map = I.view.map;
// A floor cell away from the exit, walls and props: the hero stands there.
const cands = [];
for (let y = 3; y < map.h - 3; y++) for (let x = 3; x < map.w - 3; x++) {
  let ok = Math.hypot(x - map.exit.x, y - map.exit.y) > 6;
  for (let dy = -2; dy <= 2 && ok; dy++) for (let dx = -3; dx <= 3 && ok; dx++) ok = map.cells[(y + dy) * map.w + x + dx] === "." && !map.props.some((q) => q.x === x + dx && q.y === y + dy);
  if (ok) cands.push({ x, y });
}
const spot = cands[Math.floor(cands.length / 2)];
check(!!spot, `a clear floor spot in the cave (${JSON.stringify(spot)}, ${cands.length} candidates)`);
await hook("interior", { at: { x: (spot.x + 0.5) * TILE, y: (spot.y + 0.5) * TILE } });
// Keep the cave's monsters out of the way (asleep, far): the check is about the UI, not the fight.
await sleep(1200);
await page.mouse.move(100, 300);

globalThis.__step = "1";
// ---- 1. the hotbar shows inside: weapons + spells on top, the tools dimmed below --------------------------------
let s = await waitUi((x) => x.topShown && x.bottomShown && x.weapons.length === 2);
const cls = await page.evaluate(() => ({ interior: document.body.classList.contains("interior-mode"), hostile: document.body.classList.contains("interior-hostile") }));
check(cls.interior && cls.hostile && twoRows(s), `inside the cave the hotbar shows both rows (${JSON.stringify({ cls, order: s.order, top: s.topShown, bottom: s.bottomShown })})`);
const tools = () => page.evaluate(() => [...document.querySelectorAll("#hero-hotbar .hh-tools .hh-slot")].map((t) => ({ off: t.classList.contains("off"), on: t.classList.contains("on"), title: t.title, dis: t.getAttribute("aria-disabled") })));
let ts = await tools();
check(ts.length === 9 && ts.every((t) => t.off && t.dis === "true" && /: Not usable in here$/.test(t.title)), `all nine tool slots dimmed, "Not usable in here" (${JSON.stringify(ts.map((t) => t.title))})`);
let n = await mark();
for (const k of ["Digit1", "Digit5", "Digit6"]) { await page.keyboard.press(k); await sleep(120); }
await page.locator("#hero-hotbar .hh-tools .hh-slot").nth(1).click({ force: true }); await sleep(200);
ts = await tools();
check(ts.every((t) => !t.on) && (await ui()).toolOn === 0, "1 / 5 / 6 and a click on a tool slot arm nothing indoors");
n = await mark();
await page.keyboard.press("Space"); await sleep(300);
let sent = await sentSince(n);
check(sent.some((m) => m.type === "combat") && !sent.some((m) => m.type === "heroTool"), `Space attacks with the weapon (no tool) inside (${JSON.stringify(sent.map((m) => m.type + ":" + (m.action ?? "")))})`);

globalThis.__step = "2";
// ---- 2. weapons: Shift+6, 0, click ---------------------------------------------------------------------------
let p = await hero();
const ws = order(p);
n = await mark();
const other = ws.find((w) => w.id !== p.equipment.weapon?.id);
await page.keyboard.press(`Shift+Digit${ws.indexOf(other) + 5}`); await sleep(500);
p = await until((x) => x.equipment.weapon?.id === other.id);
check(p.equipment.weapon?.id === other.id, `Shift+${ws.indexOf(other) + 5} wields ${other.name} inside`);
await page.keyboard.press("Digit0"); await sleep(500);
p = await until((x) => x.equipment.weapon?.id !== other.id);
check(p.equipment.weapon && p.equipment.weapon.id !== other.id, `0 cycles back to ${p.equipment.weapon?.name}`);
await clickWeapon(ws.indexOf(other));
p = await until((x) => x.equipment.weapon?.id === other.id);
check(p.equipment.weapon?.id === other.id, "a click on a weapon slot wields it inside");

globalThis.__step = "3";
// ---- 3. spells: aim Thunder, click in the room, the cast lands at interior coordinates ---------------------------
s = await ui();
check(shownSpells(s).length === 3, `three learnt spells shown in the hotbar (${JSON.stringify(s.spellBtns.map((b) => [b.kbd, b.shown, b.disabled]))})`);
await page.keyboard.press("Shift+Digit2"); await sleep(300);
s = await ui();
const hint = await page.evaluate(() => { const h = document.getElementById("interior-use-hint"); return h && !h.hidden ? h.textContent : ""; });
check(s.spellBtns[1].aiming && /Thunder · Click a target/.test(hint), `Shift+2 aims Thunder inside (aiming ${s.spellBtns[1].aiming}, cursor ${s.cursor}, hint "${hint}")`);
await page.screenshot({ path: path.join(OUT, "1-cave-aiming-1280x800.png") });
// Esc while aiming: only the aim closes (still inside, no equip / exit).
n = await mark();
await esc();
s = await ui();
sent = await sentSince(n);
check(!s.spellBtns[1].aiming && (await hook("interior")).inside && !sent.some((m) => ["interiorExit", "equipItem"].includes(m.type)), `Esc closes only the aim (${JSON.stringify(sent.map((m) => m.type))})`);
await page.keyboard.press("Shift+Digit2"); await sleep(300);
const heroAt = { x: (spot.x + 0.5) * TILE, y: (spot.y + 0.5) * TILE };
// The room is centred on the hero when larger than the screen: a point 80 px right of the hero on screen.
const heroScreen = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
n = await mark();
const ev0 = (await hook("spellState")).events.length;
await page.mouse.click(heroScreen.w / 2 + 80, heroScreen.h / 2); await sleep(600);
sent = await sentSince(n);
const cast = sent.find((m) => m.type === "castSpell");
check(cast && cast.slot === 1 && Number.isFinite(cast.x) && Number.isFinite(cast.y) && cast.x > heroAt.x && Math.hypot(cast.x - heroAt.x, cast.y - heroAt.y) < 7 * TILE,
  `a click casts Thunder at interior coordinates right of the hero (${JSON.stringify(cast)}, hero ${JSON.stringify(heroAt)})`);
const sp = await hook("spellState");
const landed = sp.events.slice(ev0).find((e) => e.type === "cast" && e.spell === "thunder");
check(!!landed, `the server cast it inside (${JSON.stringify(sp.events.slice(ev0).slice(0, 4))})`);
await sleep(300);
s = await ui();
check(parseFloat(s.spellBtns[1].cd) > 0, `Thunder shows its cooldown overlay (${s.spellBtns[1].cd})`);
n = await mark();
await page.keyboard.press("Shift+Digit1"); await sleep(200);
await page.keyboard.press("Shift+Digit1"); await sleep(500);
sent = await sentSince(n);
check(sent.some((m) => m.type === "castSpell" && m.slot === 0), `Shift+1 twice heals yourself inside (${JSON.stringify(sent.map((m) => m.type))})`);
n = await mark();
await page.keyboard.press("F1"); await sleep(300);
check(!(await sentSince(n)).some((m) => m.type === "castSpell") && /Heal: \d+ s cooldown/.test(await toasts()), "F1 on cooldown: a cooldown toast, no cast");

globalThis.__step = "4";
// ---- 4. a dropped stack is drawn in the room, "E: pick up", E takes it -------------------------------------------
await hook("heroLife", { pack: { wood: 4 } });
await sleep(1100);
await send({ type: "dropGood", good: "wood", qty: 4 });
await sleep(800);
const g = await hook("groundItems");
check(g.items.length === 1 && g.items[0].scope, `the drop lies in the cave (${JSON.stringify(g.items)})`);
await sleep(1700);
await page.screenshot({ path: path.join(OUT, "2-cave-drop-1280x800.png") });
n = await mark();
await page.keyboard.press("KeyE"); await sleep(600);
const g2 = await hook("groundItems");
const pack = (await hook("heroLife")).life.pack;
check(g2.items.length === 0 && pack.wood === 4, `E picks the stack up inside (pack wood ${pack.wood}, ${JSON.stringify((await sentSince(n)).map((m) => m.type))})`);

globalThis.__step = "5";
// ---- 5. layout at both sizes, clear of the interior HUD / use hint / hero bar / tracker -----------------------------
async function interiorLayout(tag) {
  const vp = page.viewportSize();
  const topR = await rect("#hero-hotbar .hh-top"), botR = await rect("#hero-hotbar .hh-bottom");
  const bar = topR && botR ? { l: Math.min(topR.l, botR.l), t: topR.t, r: Math.max(topR.r, botR.r), b: botR.b } : null;
  check(bar && bar.l >= 0 && bar.r <= vp.width && bar.t >= 0 && bar.b <= vp.height, `${tag} ${vp.width}x${vp.height}: hotbar on screen (${JSON.stringify(bar)})`);
  const others = { "interior HUD": await rect("#int-hud"), "use hint": await rect("#interior-use-hint"), "hero bar": await rect("#hero-bar"), tracker: await rect("#adventure-tracker"), "combat guide": await rect("#combat-guide"), "player bar": await rect("#player-bar") };
  const hits = Object.entries(others).filter(([, r]) => overlap(bar, r)).map(([k]) => k);
  const hintR = others["use hint"];
  const hintHits = Object.entries({ hotbar: bar, "hero bar": others["hero bar"], "combat guide": others["combat guide"] }).filter(([, r]) => overlap(hintR, r)).map(([k]) => k);
  check(hintHits.length === 0, `${tag} ${vp.width}x${vp.height}: the interior use hint sits clear of the bottom HUD (${hintHits.join(", ") || "no overlap"}; hint ${JSON.stringify(hintR)})`);
  check(hits.length === 0, `${tag} ${vp.width}x${vp.height}: the hotbar covers nothing (${hits.join(", ") || "no overlap"}; ${JSON.stringify(others)})`);
  await page.screenshot({ path: path.join(OUT, `${tag}-${vp.width}x${vp.height}.png`) });
}
await page.keyboard.press("Shift+Digit3"); await sleep(300);
for (const [w, h] of [[1280, 800], [1024, 720]]) { await page.setViewportSize({ width: w, height: h }); await sleep(700); await interiorLayout("3-cave-aiming"); }
await esc();
for (const [w, h] of [[1280, 800], [1024, 720]]) { await page.setViewportSize({ width: w, height: h }); await sleep(700); await interiorLayout("4-cave"); }
await page.setViewportSize({ width: 1280, height: 800 }); await sleep(300);

globalThis.__step = "6";
// ---- 6. a peaceful house keeps the hotbar hidden ---------------------------------------------------------------
await hook("interior", { exit: true });
await sleep(500);
await hook("teleportPlayer", { x: (HOUSE.x + 0.5) * TILE, y: (HOUSE.y + 1.5) * TILE });
I = await hook("interior", { enter: { tx: HOUSE.x, ty: HOUSE.y } });
await sleep(800);
s = await ui();
const hcls = await page.evaluate(() => ({ interior: document.body.classList.contains("interior-mode"), hostile: document.body.classList.contains("interior-hostile") }));
check(I.why === "" && hcls.interior && !hcls.hostile && !s.topShown && !s.bottomShown, `inside a house the hotbar stays hidden (${JSON.stringify({ why: I.why, hcls, top: s.topShown })})`);
await page.screenshot({ path: path.join(OUT, "5-house-1280x800.png") });
await hook("interior", { exit: true });
await sleep(800);
s = await ui();
check(twoRows(s) && !(await page.evaluate(() => document.body.classList.contains("interior-hostile"))), "outside again: both rows, no interior class");

check(pageErrors.length === 0, `no page errors (${JSON.stringify(pageErrors)})`);
await browser.close();
cleanup();
const failed = results.filter((r) => !r.ok);
writeFileSync(path.join(OUT, "result.json"), JSON.stringify({ when: new Date().toISOString(), results, pageErrors }, null, 1));
writeFileSync(path.join(OUT, "server.log"), serverLog);
console.log(`interior-smoke: ${results.length - failed.length}/${results.length} passed (out ${OUT})`);
console.log(failed.length ? "FAIL" : "PASS");
process.exit(failed.length ? 1 : 0);
