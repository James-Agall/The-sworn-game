#!/usr/bin/env node
// Esc = weapon ready (2026-11-27): browser check of the Escape key. Not part of `npm test` (the runner only picks up
// *-test.mjs): it needs Playwright + a Chromium from outside the repo, like client/split-smoke.mjs.
//
//   node client/esc-smoke.mjs --out <scratch dir> [--port 31960] [--no-build]
//
// It builds the client (vite, --outDir <out>/dist, VITE_SERVER_URL baked to the private port), boots a private server
// (scratch COLONY_SAVE_DIR, COLONY_TEST_HOOKS=1, world 160, seed 42), serves the build on port+1 and checks in a
// Creative game: (1) Esc drops the build tool (no toolbar highlight, no hover box, blank requirements, right / left
// clicks send no placement or demolish) and a picked tool places again; (4) Esc wields a pack weapon when the slot
// is empty (the last used one, else the best tier; never a bow with a shield; never swaps a wielded one); (2) Esc puts
// the hotbar tool away (weapon slot lit, Space attacks); (3) one Esc closes the inventory / the Menu list / the
// demolish confirm and keeps the tool, the next one drops it; (5) Esc in a <select> does nothing; (6) no page errors.
// Env: PW_MODULE_FROM (package.json whose node_modules has playwright), PW_CHROME (chromium binary).
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
const OUT = path.resolve(arg("out", mkdtempSync(path.join(os.tmpdir(), "esc-smoke-"))));
const PORT = Number(arg("port", "31960"));
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
const saveDir = mkdtempSync(path.join(os.tmpdir(), "esc-smoke-saves-"));
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
page.on("pageerror", (e) => pageErrors.push(String(e.message)));
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
const PLACE = ["setTile", "placeStructure", "zoneEdit", "placeBlueprint"];
const mark = () => page.evaluate(() => window.__sent.length);
const sentSince = (n) => page.evaluate((n) => window.__sent.slice(n), n);
const placed = async (n) => (await sentSince(n)).filter((m) => PLACE.includes(m.type));
const visible = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const cs = getComputedStyle(e); return !e.hidden && cs.display !== "none" && cs.visibility !== "hidden"; }, sel);
const ui = () => page.evaluate(() => ({
  tool: document.querySelector("#toolbar .tool-btn.selected")?.textContent?.trim() ?? null,
  req: document.getElementById("build-requirements")?.textContent ?? null,
  weaponOn: !!document.querySelector(".hh-weapons .hh-slot.on"),
  toolOn: [...document.querySelectorAll(".hh-slot.on")].some((s) => !s.closest(".hh-weapons")),
  buildOpen: !document.getElementById("build-panel").classList.contains("collapsed"),
}));
const setBuildOpen = async (open) => { if ((await ui()).buildOpen !== open) { await page.click("#build-panel-toggle"); await sleep(200); } };
// Pick a build tool the way the toolbar button does (its click handler), wherever the button sits.
const pickTool = async (re) => {
  const label = await page.evaluate((src) => {
    const btn = [...document.querySelectorAll("#toolbar .tool-btn")].find((b) => new RegExp(src).test(b.textContent.trim()));
    btn?.click();
    return btn?.textContent?.trim() ?? null;
  }, re.source);
  await sleep(150);
  return label;
};
const esc = async () => { await page.keyboard.press("Escape"); await sleep(250); };
const hero = async () => (await hook("heroState")).profile;
// The hero's gear as the client sees it is only the server's after the next heroProfile push: poll the hook.
const until = async (pred, ms = 4000) => { const t = Date.now(); let p; while (Date.now() - t < ms) { p = await hero(); if (pred(p)) return p; await sleep(150); } return p; };
// A canvas point (not under a panel) near the screen centre.
const canvasPoint = async (dx = 3, dy = 2) => page.evaluate(([dx, dy]) => {
  for (let r = 0; r < 12; r++) for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const x = 640 + sx * (dx + r) * 32, y = 400 + sy * (dy + Math.floor(r / 2)) * 32;
    if (document.elementFromPoint(x, y)?.tagName === "CANVAS") return [x, y];
  }
  return [640, 400];
}, [dx, dy]);
// Fraction of pixels that differ between two screenshot buffers (decoded on a canvas in the page).
async function diffFrac(a, b) {
  return page.evaluate(async ([a, b]) => {
    const load = async (d) => { const img = new Image(); img.src = "data:image/png;base64," + d; await img.decode(); const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const x = c.getContext("2d"); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
    const da = await load(a), db = await load(b);
    let n = 0;
    for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 60) n++;
    return n / (da.length / 4);
  }, [a.toString("base64"), b.toString("base64")]);
}

await page.goto(`http://127.0.0.1:${WEB_PORT}/?mode=creative`);
await page.getByRole("button", { name: "New Game (Creative)" }).or(page.locator("#menu-creative")).first().click();
await page.waitForFunction(() => window.__ws && window.__ws.readyState === 1, null, { timeout: 120000 });
await page.waitForFunction(() => { const l = document.getElementById("loading-screen"); const t = document.body.innerText; return (!l || l.hidden || getComputedStyle(l).display === "none") && !/Forging a new world/.test(t); }, null, { timeout: 180000 });
await sleep(4000);
await hook("setInstantBuild", { enabled: true });

// ---- (1) build tools: Esc leaves the no-tool state ---------------------------------------------------------------
await send({ type: "pause", paused: true });
await setBuildOpen(true);
const [px, py] = await canvasPoint();
const clip = { x: px - 40, y: py - 40, width: 80, height: 80 };
check(/^Wood Wall/.test((await pickTool(/^Wood Wall/)) ?? ""), "the Build panel has a Wood Wall tool");
await page.mouse.move(px, py); await sleep(150); await page.mouse.move(px + 1, py + 1); await sleep(250);
const shotTool = await page.screenshot({ clip });
await esc();
let s = await ui();
check(s.tool === null, `Esc with Wood Wall: toolbar shows no selected tool (${s.tool})`);
check(s.req === "", `Esc: the requirements text is blank (${JSON.stringify(s.req)})`);
check(s.buildOpen, "Esc leaves the Build panel open");
await page.mouse.move(px + 2, py + 2); await sleep(250);
const shotNone = await page.screenshot({ clip });
await page.mouse.move(px + 4, py + 3); await sleep(250);
const shotNone2 = await page.screenshot({ clip });
const dTool = await diffFrac(shotTool, shotNone), dNone = await diffFrac(shotNone, shotNone2);
check(dTool > 0.02 && dNone < dTool / 4, `the hover box / ghost is gone with no tool (tool vs none ${(dTool * 100).toFixed(1)}%, none vs none ${(dNone * 100).toFixed(1)}%)`);
for (const [re, what] of [[/^Bed/, "Bed (furniture)"], [/^Stockpile/, "Stockpile (zone)"], [/^Place blueprint/, "Place blueprint"], [/^Cottage/, "Cottage (building)"]]) {
  const label = await pickTool(re);
  if (!label) { check(false, `the Build panel has ${what}`); continue; }
  check((await ui()).tool === label, `${what} is selected`);
  await esc();
  check((await ui()).tool === null, `Esc with ${what}: no tool selected`);
  const n = await mark();
  await page.mouse.click(px, py, { button: "right" });
  await sleep(150);
  await page.mouse.move(px + 40, py + 10, { steps: 3 });
  await page.mouse.down({ button: "right" }); await page.mouse.move(px + 90, py + 10, { steps: 4 }); await page.mouse.up({ button: "right" });
  await page.mouse.click(px, py);
  await sleep(400);
  const bad = await placed(n);
  check(bad.length === 0, `no tool after ${what}: right-click, right-drag and left-click send no placement / demolish (${JSON.stringify(bad)})`);
}
const nPick = await mark();
await pickTool(/^Wood Wall/);
check(/^Wood Wall/.test((await ui()).tool ?? ""), "picking Wood Wall again selects it");
await page.mouse.click(px, py, { button: "right" });
await sleep(400);
check((await placed(nPick)).some((m) => m.type === "placeStructure"), "right-click with Wood Wall places again (placeStructure sent)");
await page.screenshot({ path: path.join(OUT, "1-build.png") });

// ---- (4) Esc wields a pack weapon when the weapon slot is empty ---------------------------------------------------
await send({ type: "pause", paused: false });
await setBuildOpen(false);
await esc();
let p = await hero();
if (p.equipment.weapon) await send({ type: "unequipItem", slot: "weapon" });
if (p.equipment.offhand) await send({ type: "unequipItem", slot: "offhand" });
p = await until((q) => !q.equipment.weapon && !q.equipment.offhand);
for (const i of p.inventory) if (i.slot === "weapon" || i.slot === "offhand") await send({ type: "dropGear", itemId: i.id });
await hook("setEquipment", { armour: [9, 9, 9], weapon: [9, 9, 9] });
await send({ type: "takeFromArmoury", slot: "armour", tier: 1, armourPart: "offhand" });
await send({ type: "takeFromArmoury", slot: "weapon", tier: 1, weaponKind: "bow" });
p = await until((q) => q.inventory.some((i) => i.kind === "shield") && q.inventory.some((i) => i.kind === "bow"));
const shield = p.inventory.find((i) => i.kind === "shield");
await send({ type: "equipItem", itemId: shield.id, slot: "offhand" });
p = await until((q) => q.equipment.offhand?.id === shield.id);
await sleep(400);
let n = await mark();
await esc(); await sleep(400);
let eq = (await sentSince(n)).filter((m) => m.type === "equipItem");
p = await hero();
check(eq.length === 0 && !p.equipment.weapon, `bow + shield: Esc does not wield the bow (${JSON.stringify(eq)})`);
await send({ type: "unequipItem", slot: "offhand" });
await send({ type: "takeFromArmoury", slot: "weapon", tier: 1, weaponKind: "sword" });
await send({ type: "takeFromArmoury", slot: "weapon", tier: 3, weaponKind: "spear" });
p = await until((q) => !q.equipment.offhand && q.inventory.some((i) => i.kind === "sword") && q.inventory.some((i) => i.kind === "spear"));
await sleep(400);
const sword = p.inventory.find((i) => i.kind === "sword"), spear = p.inventory.find((i) => i.kind === "spear");
n = await mark();
await esc();
p = await until((q) => !!q.equipment.weapon);
eq = (await sentSince(n)).filter((m) => m.type === "equipItem");
const toast = await page.evaluate(() => [...document.querySelectorAll(".event-toast")].map((t) => t.textContent).join(" | "));
check(eq.length === 1 && eq[0].itemId === spear.id && p.equipment.weapon?.id === spear.id, `empty slot: Esc wields the best tier (${spear.name}; sent ${JSON.stringify(eq)}, wielded ${p.equipment.weapon?.name})`);
check(toast.includes(`Weapon ready: ${spear.name}`), `toast "Weapon ready: ${spear.name}" (${toast.slice(-200)})`);
// The last used weapon beats a higher tier.
await send({ type: "equipItem", itemId: sword.id, slot: "weapon" });
p = await until((q) => q.equipment.weapon?.id === sword.id);
await sleep(400);
await send({ type: "unequipItem", slot: "weapon" });
p = await until((q) => !q.equipment.weapon);
await sleep(400);
n = await mark();
await esc();
p = await until((q) => !!q.equipment.weapon);
eq = (await sentSince(n)).filter((m) => m.type === "equipItem");
check(eq.length === 1 && p.equipment.weapon?.id === sword.id, `empty slot: Esc wields the last used weapon (${sword.name}) over a higher tier (wielded ${p.equipment.weapon?.name})`);
await sleep(400);
n = await mark();
await esc(); await sleep(300);
eq = (await sentSince(n)).filter((m) => m.type === "equipItem" || m.type === "unequipItem");
check(eq.length === 0 && (await hero()).equipment.weapon?.id === sword.id, `a wielded weapon: Esc swaps / unequips nothing (${JSON.stringify(eq)})`);

// ---- (2) hotbar tool: Esc puts it away, Space attacks ------------------------------------------------------------
await page.mouse.move(px, py);
await page.keyboard.press("Digit1"); await sleep(250);
s = await ui();
check(s.toolOn && !s.weaponOn, `1 arms the first hotbar tool (tool slot lit ${s.toolOn}, weapon slot lit ${s.weaponOn})`);
await esc();
s = await ui();
check(!s.toolOn && s.weaponOn, `Esc puts the hotbar tool away: the weapon slot is lit (${JSON.stringify(s)})`);
n = await mark();
await page.keyboard.down("Space"); await sleep(120); await page.keyboard.up("Space"); await sleep(400);
const sp = await sentSince(n);
check(sp.some((m) => m.type === "combat" && m.action === "press") && !sp.some((m) => m.type === "heroTool"), `Space attacks (combat press) and uses no tool (${JSON.stringify(sp.map((m) => m.type + (m.action ? ":" + m.action : "")))})`);
// The same with the Build panel open and no build tool: weapon ready too.
await setBuildOpen(true);
await esc();
n = await mark();
await page.keyboard.down("Space"); await sleep(120); await page.keyboard.up("Space"); await sleep(400);
check((await sentSince(n)).some((m) => m.type === "combat" && m.action === "press"), "Build panel open + no tool: Space attacks");
await setBuildOpen(false);

// ---- (3) precedence: one Esc closes the top thing only ---------------------------------------------------------
await send({ type: "pause", paused: true });
await setBuildOpen(true);
await pickTool(/^Wood Wall/);
await page.keyboard.press("Backquote"); await sleep(400);
check(await visible("#hero-modal"), "` opens the inventory sheet");
await esc();
check(!(await visible("#hero-modal")) && /^Wood Wall/.test((await ui()).tool ?? ""), `Esc with the inventory open closes only the sheet (tool ${(await ui()).tool})`);
await esc();
check((await ui()).tool === null, "a second Esc drops the tool");
await pickTool(/^Wood Wall/);
await page.click("#menu-btn"); await sleep(300);
check(await visible("#menu-dropdown-list"), "Menu opens its list");
await esc();
check(!(await visible("#menu-dropdown-list")) && /^Wood Wall/.test((await ui()).tool ?? ""), `Esc with the Menu list open closes only the list (tool ${(await ui()).tool})`);
await esc();
check((await ui()).tool === null, "a second Esc drops the tool (Menu)");
// Demolish confirm: a Cottage (instant build), then Demolish + right-click on it.
await send({ type: "pause", paused: false });
await pickTool(/^Cottage/);
await page.evaluate(() => { window.__recv.tileUpdates.length = 0; });
let cottageAt = null;
for (const [dx, dy] of [[0, 0], [2, 0], [0, 2], [-2, 0], [0, -2], [3, 3], [-3, 3]]) {
  const [x, y] = [px + 32 * dx, py + 32 * dy];
  if (!(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName === "CANVAS", [x, y]))) continue;
  await page.mouse.move(x, y); await sleep(100);
  await page.mouse.click(x, y, { button: "right" });
  const ok = await page.waitForFunction(() => window.__recv.tileUpdates.length > 0, null, { timeout: 2500 }).then(() => true, () => false);
  if (ok) { cottageAt = [x, y]; break; }
}
check(!!cottageAt, "a Cottage was placed for the demolish confirm");
if (cottageAt) {
  await sleep(600);
  await pickTool(/^Demolish/);
  await page.mouse.click(cottageAt[0], cottageAt[1], { button: "right" });
  await sleep(400);
  check(await visible("#demolish-confirm"), "Demolish + right-click on the Cottage asks to confirm");
  const nD = await mark();
  await esc();
  check(!(await visible("#demolish-confirm")) && /^Demolish/.test((await ui()).tool ?? ""), `Esc with the demolish confirm closes only the confirm (tool ${(await ui()).tool})`);
  check((await placed(nD)).length === 0, "Esc on the confirm demolishes nothing");
  await esc();
  check((await ui()).tool === null, "a second Esc drops the Demolish tool");
}

// ---- (5) Esc in a <select> does nothing special -----------------------------------------------------------------
await pickTool(/^Wood Wall/);
const selOk = await page.evaluate(() => {
  const panel = document.getElementById("economy-panel");
  if (panel?.classList.contains("collapsed")) document.getElementById("economy-panel-toggle")?.click();
  const sel = document.querySelector('select[aria-label="Resource to withdraw"]');
  sel?.focus();
  return document.activeElement === sel;
});
check(selOk, "the Stockpile withdraw <select> takes the focus");
await esc();
check(/^Wood Wall/.test((await ui()).tool ?? ""), `Esc inside the <select> keeps the tool (${(await ui()).tool})`);
await page.evaluate(() => document.activeElement?.blur());
await esc();
check((await ui()).tool === null, "Esc outside the <select> drops the tool");
await page.screenshot({ path: path.join(OUT, "5-final.png") });

// ---- (6) ----------------------------------------------------------------------------------------------------------
check(pageErrors.length === 0, `no page errors (${JSON.stringify(pageErrors)})`);
await browser.close();
cleanup();
const failed = results.filter((r) => !r.ok);
writeFileSync(path.join(OUT, "result.json"), JSON.stringify({ when: new Date().toISOString(), results, pageErrors }, null, 1));
writeFileSync(path.join(OUT, "server.log"), serverLog);
console.log(`esc-smoke: ${results.length - failed.length}/${results.length} passed (out ${OUT})`);
console.log(failed.length ? "FAIL" : "PASS");
process.exit(failed.length ? 1 : 0);
