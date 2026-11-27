#!/usr/bin/env node
// Gear deposit tiers 2026-11-27: browser check of the hero sheet's armoury deposit (select mode + special weapons). Not
// part of `npm test` (the runner only picks up *-test.mjs): it needs Playwright + a Chromium from outside the repo.
//
//   node client/gear-deposit-smoke.mjs --out <scratch dir> [--port 31940] [--no-build]
//
// Builds the client (vite, --outDir <out>/dist), boots a private server (scratch COLONY_SAVE_DIR, COLONY_TEST_HOOKS=1,
// world 160, seed 42), serves the build on port+1 and, in a Creative game next to the Town Center with plain + special
// weapons and armour in the pack (packGear / grantRelic / grantTome hooks): the item tooltip and context menu show the
// deposit tier and the special warning, the menu asks before a relic goes in; Ctrl+click selects outside select mode
// without equipping; the Select toggle, click toggles, Shift+click range, ineligible items dimmed and unselectable,
// Select all eligible, Clear, the live count, the Deposit selected button text + summary and its disabled state away
// from a store; keyboard Space toggles (aria-pressed); the special-weapon confirm (Esc cancels it); a deposit changes the
// pack and the armoury stock buttons and clears the selection; Esc leaves select mode first, then closes the sheet;
// a normal click still equips; no page errors. Screenshots (1280x800) in <out>.
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
const OUT = path.resolve(arg("out", mkdtempSync(path.join(os.tmpdir(), "gear-deposit-smoke-"))));
const PORT = Number(arg("port", "31940"));
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
const saveDir = mkdtempSync(path.join(os.tmpdir(), "gear-deposit-smoke-saves-"));
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
const mark = () => page.evaluate(() => window.__sent.length);
const sentSince = (n) => page.evaluate((n) => window.__sent.slice(n).filter((m) => m.type !== "testHook"), n);
const esc = async () => { await page.keyboard.press("Escape"); await sleep(250); };
const hero = async () => (await hook("heroState")).profile;
const until = async (pred, ms = 5000) => { const t = Date.now(); let p; while (Date.now() - t < ms) { p = await hero(); if (pred(p)) return p; await sleep(150); } return p; };
const toasts = () => page.evaluate(() => [...document.querySelectorAll(".event-toast")].map((t) => t.textContent).join(" | "));
const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const visible = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && e.checkVisibility(); }, sel);
// The pack grid as drawn.
const grid = () => page.evaluate(() => [...document.querySelectorAll("#hs-inv [data-pack-idx]")].map((el) => ({
  idx: Number(el.dataset.packIdx), on: el.classList.contains("hs-sel-on"), dim: el.classList.contains("hs-sel-dim"), check: !!el.querySelector(".hs-check"),
  pressed: el.getAttribute("aria-pressed"), disabled: el.getAttribute("aria-disabled"),
})));
const bar = () => page.evaluate(() => {
  const b = document.getElementById("hs-select-bar");
  const q = (s) => b?.querySelector(s);
  return {
    toggle: q(".hs-sel-toggle")?.textContent, pressed: q(".hs-sel-toggle")?.getAttribute("aria-pressed"),
    count: q(".hs-sel-count")?.textContent ?? null, info: q(".hs-sel-info")?.textContent ?? null,
    dep: q(".hs-sel-deposit")?.textContent ?? null, depDisabled: q(".hs-sel-deposit")?.disabled ?? null, depTitle: q(".hs-sel-deposit")?.title ?? null,
    confirm: q(".hs-sel-confirm")?.textContent ?? null, all: !!q(".hs-sel-all"), clear: !!q(".hs-sel-clear"),
  };
});
const cell = (i) => page.locator(`#hs-inv [data-pack-idx="${i}"]`);
const stockText = () => page.evaluate(() => [...document.querySelectorAll("#hs-armoury button")].map((b) => b.textContent).join(" | "));

await page.goto(`http://127.0.0.1:${WEB_PORT}/?mode=creative`);
await page.getByRole("button", { name: "New Game (Creative)" }).or(page.locator("#menu-creative")).first().click();
await page.waitForFunction(() => window.__ws && window.__ws.readyState === 1, null, { timeout: 120000 });
await page.waitForFunction(() => { const l = document.getElementById("loading-screen"); const t = document.body.innerText; return (!l || l.hidden || getComputedStyle(l).display === "none") && !/Forging a new world/.test(t); }, null, { timeout: 180000 });
await sleep(4000);
await page.mouse.move(640, 300);

// ---- setup: next to the Town Center, an empty armoury, a pack of plain + special gear ------------------------------
await send({ type: "pause", paused: true });
await hook("setRaids", { enabled: false });
await hook("heroLife", { needs: false, pack: {} });
const tc = (await hook("constructionState")).townCenters?.[0];
check(!!tc, `the Creative colony has a Town Center (${JSON.stringify(tc)})`);
const px = (t) => t * 32 + 16;
await hook("teleportPlayer", { x: px(tc.x), y: px(tc.y + 2) });
// Creative tops the armoury up to 9999 after every tick: switch that off so the stock counts are real.
await hook("peopleState", { creative: false });
await hook("setEquipment", { armour: [0, 0, 0], weapon: [0, 0, 0] });
let uid = 0;
const it = (slot, tier, kind, name, stats, extra = {}) => ({ id: `g-${String(++uid).padStart(2, "0")}`, slot, tier, kind, name, stats, ...extra });
const PACK = [
  it("weapon", 1, "sword", "Iron Sword", { damagePct: 20 }),
  it("weapon", 2, "axe", "Steel Axe", { damagePct: 40 }),
  it("legs", 1, "greaves", "Iron Greaves", { damageTakenPct: -5 }),
  it("head", 1, "helm", "Bronze Helm", { damageTakenPct: -6 }),
  it("weapon", 1, "axe", "Breaching axe", { damagePct: -2 }, { adventureTrait: "breach" }),
  it("chest", 2, "cuirass", "Steel Breastplate", { damageTakenPct: -30 }),
];
for (const item of PACK) await hook("packGear", { item });
const relic = (await hook("grantRelic", { relicId: "gunneTooth" })).item;
const relicHelm = (await hook("grantRelic", { relicId: "oathkeeperHelm" })).item;
const tome = (await hook("grantTome", {})).item;
let p = await until((x) => x.inventory.length === PACK.length + 3);
check(p.inventory.length === PACK.length + 3 && !!relic && !!relicHelm && !!tome, `pack: ${p.inventory.map((i) => i.name).join(", ")}`);
// Pack order (server order): sword 0, steel axe 1, greaves 2, helm 3, breaching axe 4, breastplate 5, Gunne's Tooth 6, relic helm 7, tome 8.
const ELIGIBLE = [0, 1, 3, 4, 5, 6], INELIGIBLE = [2, 7, 8];

await page.keyboard.press("Backquote");
await page.waitForFunction((n) => document.querySelectorAll("#hs-inv [data-pack-idx]").length === n, PACK.length + 3, { timeout: 8000 });
await page.waitForFunction(() => !document.querySelector("#hs-armoury .hs-deposit-gear")?.disabled, null, { timeout: 8000 }).catch(() => {});
check(await visible("#hero-modal"), "the inventory sheet opens (`)");
check(/Deposit gear to armoury \(4\)/.test(await stockText()), `the armoury "Deposit gear" button counts the 4 PLAIN pieces only (${await stockText()})`);

// ---- tooltip + context menu of a special weapon ---------------------------------------------------------------------
await cell(6).hover(); await sleep(250);
const tip = await page.evaluate(() => document.getElementById("hs-tip")?.innerText ?? "");
check(/Deposit to armoury: goes in as a tier 3 weapon \(special: \+1 tier\)/.test(tip) && /comes back as a plain tier-3 weapon \(its unique stats and relic status are lost\)/.test(tip), `relic tooltip shows the deposit tier and the warning: ${JSON.stringify(tip)}`);
await shot("1-relic-tooltip");
await cell(0).hover(); await sleep(250);
const tip0 = await page.evaluate(() => document.getElementById("hs-tip")?.innerText ?? "");
check(/Deposit to armoury: goes in as a tier 1 weapon/.test(tip0) && !/special/.test(tip0), `plain sword tooltip: tier 1, no special note (${JSON.stringify(tip0)})`);
await cell(2).hover(); await sleep(250);
check(/Armoury: Leg armour can't go into the armoury/.test(await page.evaluate(() => document.getElementById("hs-tip")?.innerText ?? "")), "leg armour tooltip gives the refusal");
let n0 = await mark();
await cell(6).click({ button: "right" }); await sleep(250);
const menu = () => page.evaluate(() => ({ shown: !document.getElementById("hs-item-menu").hidden, items: [...document.querySelectorAll("#hs-item-menu button")].map((b) => b.textContent), note: document.querySelector("#hs-item-menu .hs-menu-note")?.textContent ?? null }));
let m = await menu();
check(m.shown && m.items.includes("Deposit to armoury: goes in as a tier 3 weapon (special: +1 tier)"), `context menu entry names the tier (${JSON.stringify(m.items)})`);
await page.locator("#hs-item-menu button", { hasText: "Deposit to armoury" }).click(); await sleep(250);
m = await menu();
check(m.shown && /comes back as a plain tier-3 weapon/.test(m.note ?? "") && m.items[0] === "Yes, deposit as a plain tier-3 weapon" && (await sentSince(n0)).length === 0, `the menu asks before the relic goes in, nothing sent yet (${JSON.stringify(m)})`);
await shot("2-relic-menu-confirm");
await esc();
check(!(await menu()).shown && await visible("#hero-modal") && (await sentSince(n0)).length === 0, "Esc closes only the confirm menu; the relic stays, nothing sent");

// ---- Ctrl+click outside select mode: selects without equipping ----------------------------------------------------
n0 = await mark();
await cell(1).click({ modifiers: ["Control"] }); await sleep(200);
let g = await grid(), b = await bar();
check(g[1].on && g[1].check && g[1].pressed === "true" && b.count === "1 selected" && (await sentSince(n0)).length === 0, `Ctrl+click selects the Steel Axe without equipping (${JSON.stringify({ g1: g[1], b, sent: await sentSince(n0) })})`);
await cell(1).click({ modifiers: ["Control"] }); await sleep(200);
check(!(await grid())[1].on && (await bar()).count === null, "a second Ctrl+click unselects it (bar back to just the Select button)");

// ---- select mode --------------------------------------------------------------------------------------------------
await page.locator("#hs-select-bar .hs-sel-toggle").click(); await sleep(200);
b = await bar(); g = await grid();
check(b.pressed === "true" && b.toggle === "Done selecting" && b.all && b.clear && b.count === "0 selected" && b.depDisabled && /Select items first/.test(b.depTitle), `Select mode on: toggle pressed, buttons shown, deposit disabled with a reason (${JSON.stringify(b)})`);
check(INELIGIBLE.every((i) => g[i].dim && g[i].disabled === "true") && ELIGIBLE.every((i) => !g[i].dim && g[i].pressed === "false"), `ineligible items dimmed (${INELIGIBLE}), eligible ones aria-pressed=false (${JSON.stringify(g)})`);
n0 = await mark();
await cell(0).click(); await sleep(150);
await cell(2).click({ force: true }); await sleep(150);
g = await grid();
check(g[0].on && !g[2].on && (await sentSince(n0)).length === 0, "click toggles the sword on; clicking the dimmed greaves does nothing; no equip sent");
await cell(5).click({ modifiers: ["Shift"] }); await sleep(150);
g = await grid(); b = await bar();
check([0, 1, 3, 4, 5].every((i) => g[i].on) && !g[2].on && !g[6].on && b.count === "5 selected", `Shift+click selects the eligible range 0..5 (greaves skipped) (${g.filter((x) => x.on).map((x) => x.idx)}; ${b.count})`);
check(b.dep === "Deposit selected (5) to armoury" && !b.depDisabled && b.info === "5 items: 3 weapons (T1 x1, T2 x2), 2 armour (T1 x1, T2 x1)", `deposit button + summary (${b.dep} / ${b.info})`);
await shot("3-select-range");
await page.locator("#hs-select-bar .hs-sel-clear").click(); await sleep(150);
check((await grid()).every((x) => !x.on) && (await bar()).count === "0 selected", "Clear empties the selection");
await page.locator("#hs-select-bar .hs-sel-all").click(); await sleep(150);
g = await grid(); b = await bar();
check(ELIGIBLE.every((i) => g[i].on) && INELIGIBLE.every((i) => !g[i].on) && b.count === "6 selected" && b.info === "6 items: 4 weapons (T1 x1, T2 x2, T3 x1), 2 armour (T1 x1, T2 x1)", `Select all eligible: 6 (${b.info})`);
// Keyboard: Space on a focused item toggles it.
await cell(3).focus(); await page.keyboard.press("Space"); await sleep(150);
g = await grid();
check(!g[3].on && g[3].pressed === "false" && (await bar()).count === "5 selected", "Space on the focused helm unselects it (aria-pressed=false)");
await page.keyboard.press("Enter"); await sleep(150);
check((await grid())[3].on && (await bar()).count === "6 selected", "Enter selects it again");

// ---- away from a store: the button is disabled with the reason ------------------------------------------------------
await hook("teleportPlayer", { x: px(Math.min(150, tc.x + 25)), y: px(tc.y) });
await page.waitForFunction(() => document.querySelector("#hs-select-bar .hs-sel-deposit")?.disabled, null, { timeout: 8000 }).catch(() => {});
b = await bar();
check(b.depDisabled && /Stand next to your Town Center or a storage chest/.test(b.depTitle) && /Stand next to/.test(b.info) && b.count === "6 selected", `away from a store: Deposit selected disabled, the selection kept (${JSON.stringify(b)})`);
await shot("4-away-from-store");
await hook("teleportPlayer", { x: px(tc.x), y: px(tc.y + 2) });
await page.waitForFunction(() => !document.querySelector("#hs-select-bar .hs-sel-deposit")?.disabled, null, { timeout: 8000 }).catch(() => {});
check(!(await bar()).depDisabled, "back at the Town Center the button enables");

// ---- the special-weapon confirm, Esc cancels it -------------------------------------------------------------------
n0 = await mark();
await page.locator("#hs-select-bar .hs-sel-deposit").click(); await sleep(200);
b = await bar();
check(/2 special weapons \(\+1 tier\): they come back as plain weapons and lose their unique stats and relic status/.test(b.confirm ?? "") && (await sentSince(n0)).length === 0, `confirm shown for the 2 special weapons, nothing sent (${b.confirm})`);
await shot("5-special-confirm");
await esc();
b = await bar();
check(b.confirm === null && b.pressed === "true" && b.count === "6 selected" && await visible("#hero-modal"), "Esc cancels only the confirm (select mode, selection and sheet stay)");
await page.locator("#hs-select-bar .hs-sel-deposit").click(); await sleep(200);
await page.locator("#hs-select-bar .hs-sel-yes").click(); await sleep(200);
const sent = (await sentSince(n0)).filter((x) => x.type === "depositGear");
check(sent.length === 1 && sent[0].itemIds?.length === 6 && ELIGIBLE.every((i) => sent[0].itemIds.includes(p.inventory[i].id)), `one depositGear with the 6 ids (${JSON.stringify(sent)})`);
p = await until((x) => x.inventory.length === 3);
await page.waitForFunction(() => document.querySelectorAll("#hs-inv [data-pack-idx]").length === 3, null, { timeout: 8000 }).catch(() => {});
const eqS = (await hook("equipState")).equipment;
await sleep(600);
const st = await stockText();
check(p.inventory.map((i) => i.name).sort().join() === [relicHelm.name, tome.name, "Iron Greaves"].sort().join() && eqS.weapon.join() === "1,2,1" && eqS.armour.join() === "1,1,0",
  `pack keeps only the ineligible 3; stock weapons [${eqS.weapon}], armour [${eqS.armour}] (${p.inventory.map((i) => i.name)})`);
check(/Weapon T1 \(1\)/.test(st) && /Weapon T2 \(2\)/.test(st) && /Weapon T3 \(1\)/.test(st) && /Body armour T1 \(1\)/.test(st), `the armoury buttons show the new stock (${st})`);
b = await bar();
check(b.count === "0 selected" && b.pressed === "true" && (await grid()).every((x) => !x.on), "after the deposit the selection is cleared (select mode stays)");
const tt = await toasts();
check(/Deposited 6 items to the armoury \(tier 1 weapons: 1, tier 2 weapons: 2, tier 3 weapons: 1, tier 1 armour: 1, tier 2 armour: 1\)/.test(tt), `aggregated toast (${tt})`);
await shot("6-after-deposit");

// ---- Esc: select mode first, then the sheet ------------------------------------------------------------------------
await esc();
check((await bar()).pressed === "false" && await visible("#hero-modal") && (await bar()).count === null, "first Esc leaves select mode, the sheet stays open");
await esc();
check(!(await visible("#hero-modal")), "second Esc closes the sheet");

// ---- normal click still equips; Ctrl+click selection is cleared when the sheet closes ---------------------------------
const spear = it("weapon", 2, "spear", "Steel Spear", { damagePct: 40 });
await hook("packGear", { item: spear });
await page.keyboard.press("Backquote");
await page.waitForFunction(() => document.querySelectorAll("#hs-inv [data-pack-idx]").length === 4, null, { timeout: 8000 });
const si = (await hero()).inventory.findIndex((i) => i.id === spear.id);
await cell(si).click({ modifiers: ["Control"] }); await sleep(150);
check((await bar()).count === "1 selected", "Ctrl+click selects the spear");
await esc();
await page.keyboard.press("Backquote"); await sleep(400);
check((await bar()).count === null && (await grid()).every((x) => !x.on), "closing the sheet clears a Ctrl+click selection");
n0 = await mark();
await cell(si).click(); await sleep(300);
const eqMsg = (await sentSince(n0)).filter((x) => x.type === "equipItem");
p = await until((x) => x.equipment.weapon?.id === spear.id);
check(eqMsg.length === 1 && eqMsg[0].itemId === spear.id && p.equipment.weapon?.id === spear.id, `outside select mode a plain click equips (${JSON.stringify(eqMsg)})`);
await esc();

check(pageErrors.length === 0, `no page errors (${JSON.stringify(pageErrors)})`);
await browser.close();
cleanup();
const failed = results.filter((r) => !r.ok);
writeFileSync(path.join(OUT, "result.json"), JSON.stringify({ when: new Date().toISOString(), results, pageErrors }, null, 1));
writeFileSync(path.join(OUT, "server.log"), serverLog);
console.log(`gear-deposit-smoke: ${results.length - failed.length}/${results.length} passed (out ${OUT})`);
console.log(failed.length ? "FAIL" : "PASS");
process.exit(failed.length ? 1 : 0);
