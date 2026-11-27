#!/usr/bin/env node
// Unified hotbar (2026-11-27): browser check of the hero hotbar's TOOLS / WEAPONS / SPELLS groups. Not part of `npm test`
// (the runner only picks up *-test.mjs): it needs Playwright + a Chromium from outside the repo, like client/esc-smoke.mjs.
//
//   node client/hotbar-smoke.mjs --out <scratch dir> [--port 31980] [--no-build]
//
// It builds the client (vite, --outDir <out>/dist, VITE_SERVER_URL baked to the private port), boots a private server
// (scratch COLONY_SAVE_DIR, COLONY_TEST_HOOKS=1, world 160, seed 42), serves the build on port+1 and checks in a
// Creative game: two rows (top: weapons | spells, always shown, dashed placeholders for missing weapons / unlearnt
// spells; bottom: the nine tools, Energy under it); the starter Iron Sword slot is lit; a weapon taken from the armoury gets a slot live and its Shift+5..9
// hotkey / a click wields it (equipItem, profile) with no other handler firing; 0 cycles; tool 1 unlights the weapon and
// picking a weapon puts the tool away; a bow with a shield worn is refused (server message, shield kept, tool kept);
// learnt spells appear in the hotbar (no standalone spell bar), a click / Shift+N / FN aims, Esc cancels only the aim and
// a second Esc readies the weapon, casting works with a tool armed; layout at 1280x800 and 1024x720 (no overlap with the
// hero bar / minimap / command bar, screenshots in <out>); no page errors.
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
const OUT = path.resolve(arg("out", mkdtempSync(path.join(os.tmpdir(), "hotbar-smoke-"))));
const PORT = Number(arg("port", "31980"));
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
const saveDir = mkdtempSync(path.join(os.tmpdir(), "hotbar-smoke-saves-"));
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
async function layout(tag) {
  const vp = page.viewportSize();
  const topR = await rect("#hero-hotbar .hh-top"), botR = await rect("#hero-hotbar .hh-bottom"), energy = await rect("#hero-hotbar .hh-energy");
  const slots = topR && botR ? { l: Math.min(topR.l, botR.l), t: topR.t, r: Math.max(topR.r, botR.r), b: botR.b } : null;
  check(topR && botR && topR.b <= botR.t + 0.5 && Math.abs((topR.l + topR.r) / 2 - (botR.l + botR.r) / 2) < 2,
    `${tag} ${vp.width}x${vp.height}: two rows, the top one above the tools row, both centred (${JSON.stringify({ topR, botR })})`);
  const others = { "hero bar": await rect("#hero-bar"), minimap: await rect("#minimap-frame"), "command bar": await rect("#command-bar"), stockpile: await rect("#economy-panel:not(.collapsed)"), "stockpile tab": await rect("#economy-panel-toggle"), "build tab": await rect("#build-panel-toggle"), header: await rect("#colony-header"), controls: await rect("#control-buttons"), goal: await rect("#goal-tracker"), "combat guide": await rect("#combat-guide") };
  const whole = slots && energy ? { ...slots, t: Math.min(slots.t, (await rect("#hero-hotbar .hh-hint"))?.t ?? slots.t), b: energy.b } : slots;
  const hits = Object.entries(others).filter(([, r]) => overlap(whole, r)).map(([k]) => k);
  check(slots && slots.l >= 0 && slots.r <= vp.width && slots.t >= 0, `${tag} ${vp.width}x${vp.height}: the hotbar is on screen (${JSON.stringify(slots)})`);
  check(hits.length === 0, `${tag} ${vp.width}x${vp.height}: the hotbar covers nothing (${hits.join(", ") || "no overlap"}; ${JSON.stringify(others)})`);
  check(energy && slots && energy.t >= slots.b - 0.5, `${tag} ${vp.width}x${vp.height}: the Energy row sits under the tools row (${JSON.stringify(energy)})`);
  await page.screenshot({ path: path.join(OUT, `${tag}-${vp.width}x${vp.height}.png`) });
}
async function bothSizes(tag) {
  for (const [w, h] of [[1280, 800], [1024, 720]]) { await page.setViewportSize({ width: w, height: h }); await sleep(400); await layout(tag); }
  await page.setViewportSize({ width: 1280, height: 800 }); await sleep(300);
}
// Click the i-th weapon slot.
const clickWeapon = async (i) => { await page.locator("#hero-hotbar .hh-weapons .hh-slot").nth(i).click(); await sleep(300); };
// Weapon slots follow the client's order: id order of (wielded + pack) player weapons.
const order = (p) => [p.equipment.weapon, ...p.inventory].filter((i) => i && i.slot === "weapon" && ["sword", "axe", "spear", "bow"].includes(i.kind)).sort((a, b) => (a.id < b.id ? -1 : 1));

await page.goto(`http://127.0.0.1:${WEB_PORT}/?mode=creative`);
await page.getByRole("button", { name: "New Game (Creative)" }).or(page.locator("#menu-creative")).first().click();
await page.waitForFunction(() => window.__ws && window.__ws.readyState === 1, null, { timeout: 120000 });
await page.waitForFunction(() => { const l = document.getElementById("loading-screen"); const t = document.body.innerText; return (!l || l.hidden || getComputedStyle(l).display === "none") && !/Forging a new world/.test(t); }, null, { timeout: 180000 });
await sleep(4000);
await page.mouse.move(640, 300);

// ---- 1. a fresh hero: the starter Iron Sword slot, lit; no spells ------------------------------------------------
let p = await hero();
let s = await waitUi((x) => x.weapons.length === 1 && x.weapons[0].on);
check(p.equipment.weapon?.kind === "sword" && s.weapons.length === 1 && s.weapons[0].on && s.weapons[0].label.startsWith(p.equipment.weapon.name),
  `fresh hero: one weapon slot, lit, for the wielded ${p.equipment.weapon?.name} (${JSON.stringify(s.weapons)})`);
check(s.weapons[0]?.kbd === "⇧5" && /Shift\+5/.test(s.weapons[0]?.label ?? "") && s.weapons[0]?.focusable, `the weapon slot shows its hotkey ⇧5 and is focusable (${JSON.stringify(s.weapons[0])})`);
check(twoRows(s), `two rows: top = weapons + spells, bottom = the nine tools, Energy under it (${JSON.stringify({ order: s.order, top: s.topShown, bottom: s.bottomShown, tools: s.bottomTools })})`);
check(s.weaponPh.length === 2 && s.weaponPh.map((x) => x.kbd).join() === "⇧6,⇧7" && s.weaponPh.every((x) => x.shown && !x.focusable && /^No weapon/.test(x.title)),
  `starter sword only: two dashed weapon placeholders ⇧6 ⇧7, not focusable, "No weapon" tooltip (${JSON.stringify(s.weaponPh)})`);
check(s.spellBarInHotbar && s.spellBarVisible && shownSpells(s).length === 0 && spellPh(s).length === 4 && spellPh(s).map((b) => b.kbd).join(" ") === "⇧1 ⇧2 ⇧3 ⇧4" && spellPh(s).every((b) => /^No spell learned/.test(b.title)),
  `no spells learnt: the top row shows 4 spell placeholders ⇧1..⇧4 ("No spell learned", disabled) (${JSON.stringify(s.spellBtns.map((b) => [b.kbd, b.shown, b.disabled, b.title]))})`);
const nPh = await mark();
await page.locator("#hero-hotbar .hh-weapons .hh-ph").first().click({ force: true }); await sleep(200);
await page.locator(".spell-btn").first().click({ force: true }); await sleep(200);
s = await ui();
check((await sentSince(nPh)).length === 0 && !s.spellBtns.some((b) => b.aiming) && s.weapons[0].on, "clicking placeholders does nothing");
await page.locator("#hero-hotbar .hh-weapons .hh-slot").first().hover(); await sleep(250);
const tip = await page.evaluate(() => { const t = document.getElementById("hs-tip"); return t && !t.hidden ? t.textContent : ""; });
check(/Tier 1/.test(tip) && /Shift\+5/.test(tip) && tip.includes(p.equipment.weapon.name), `the weapon slot tooltip has name, tier and hotkey (${tip})`);
await page.mouse.move(640, 300); await sleep(150);
await bothSizes("1-starter-sword-no-spells");

// ---- 2. a second weapon appears live; its hotkey and a click wield it -----------------------------------------
const sword = p.equipment.weapon;
await hook("setEquipment", { armour: [9, 9, 9], weapon: [9, 9, 9] });
await send({ type: "takeFromArmoury", slot: "weapon", tier: 3, weaponKind: "spear" });
p = await until((q) => q.inventory.some((i) => i.kind === "spear"));
const spear = p.inventory.find((i) => i.kind === "spear");
s = await waitUi((x) => x.weapons.length === 2);
let ord = order(p);
let si = ord.findIndex((w) => w.id === spear.id);
check(s.weapons.length === 2 && s.weaponPh.length === 1 && s.weaponPh[0].kbd === "⇧7" && s.weapons[si]?.label.startsWith(spear.name) && !s.weapons[si].on && s.weapons[1 - si].on, `taking a spear adds a second slot live, unlit; one placeholder (⇧7) left (${JSON.stringify(s.weapons)})`);
const tool0 = (await ui()).buildTool;
let n = await mark();
await page.keyboard.press(`Shift+Digit${5 + si}`); await sleep(400);
p = await until((q) => q.equipment.weapon?.id === spear.id);
let sent = await sentSince(n);
s = await waitUi((x) => x.weapons[si]?.on);
check(sent.length === 1 && sent[0].type === "equipItem" && sent[0].itemId === spear.id && sent[0].slot === "weapon" && p.equipment.weapon?.id === spear.id,
  `Shift+${5 + si} wields the spear (sent ${JSON.stringify(sent)}, wielded ${p.equipment.weapon?.name})`);
check(s.weapons[si].on && !s.weapons[1 - si].on && s.toolOn === 0 && s.buildTool === tool0 && !s.spellBtns.some((b) => b.aiming) && s.cursor !== "crosshair",
  `Shift+${5 + si}: only the weapon changed (build tool still ${s.buildTool}, no hotbar tool, no spell aim, no other message, no dodge)`);
n = await mark();
await clickWeapon(1 - si);
p = await until((q) => q.equipment.weapon?.id === sword.id);
sent = await sentSince(n);
check(sent.some((m) => m.type === "equipItem" && m.itemId === sword.id) && p.equipment.weapon?.id === sword.id, `clicking the sword slot wields it again (${JSON.stringify(sent)})`);
// Shift+9 with no fifth weapon does nothing.
n = await mark();
await page.keyboard.press("Shift+Digit9"); await sleep(300);
sent = await sentSince(n);
s = await ui();
check(sent.length === 0 && s.buildTool === tool0, `Shift+9 with no fifth weapon sends nothing and leaves the build tool alone (${JSON.stringify(sent)}, tool ${s.buildTool})`);

// ---- 3. key 0 cycles -------------------------------------------------------------------------------------------
n = await mark();
await page.keyboard.press("Digit0");
p = await until((q) => q.equipment.weapon?.id === spear.id);
check(p.equipment.weapon?.id === spear.id && (await sentSince(n)).some((m) => m.type === "equipItem" && m.itemId === spear.id), "0 cycles to the next weapon (the spear)");
await page.keyboard.press("Digit0");
p = await until((q) => q.equipment.weapon?.id === sword.id);
check(p.equipment.weapon?.id === sword.id, "0 again cycles back to the sword");

// ---- 4. tool vs weapon highlight ---------------------------------------------------------------------------------
await page.keyboard.press("Digit1"); await sleep(250);
s = await ui();
p = await hero();
check(s.toolOn === 1 && !s.weapons.some((w) => w.on) && p.equipment.weapon?.id === sword.id, `1 arms the first tool: no weapon slot lit, the sword stays wielded (${JSON.stringify(s.weapons)})`);
check(twoRows(s), "tool armed: still two rows");
await bothSizes("2-tool-armed");
await clickWeapon(si);
p = await until((q) => q.equipment.weapon?.id === spear.id);
s = await waitUi((x) => x.weapons[si]?.on);
check(s.toolOn === 0 && s.weapons[si].on && p.equipment.weapon?.id === spear.id, "picking a weapon slot puts the tool away and wields that weapon");
await page.keyboard.press("Digit1"); await sleep(200);
n = await mark();
await page.keyboard.press(`Shift+Digit${5 + si}`); await sleep(300);
s = await ui();
check(s.toolOn === 0 && s.weapons[si].on && (await sentSince(n)).length === 0, "the wielded weapon's hotkey with a tool armed puts the tool away and sends nothing");

// ---- 5. a bow with a shield worn is refused --------------------------------------------------------------------
await send({ type: "takeFromArmoury", slot: "weapon", tier: 1, weaponKind: "bow" });
await send({ type: "takeFromArmoury", slot: "armour", tier: 1, armourPart: "offhand" });
p = await until((q) => q.inventory.some((i) => i.kind === "bow") && q.inventory.some((i) => i.kind === "shield"));
const bow = p.inventory.find((i) => i.kind === "bow"), shield = p.inventory.find((i) => i.kind === "shield");
await send({ type: "equipItem", itemId: shield.id, slot: "offhand" });
p = await until((q) => q.equipment.offhand?.id === shield.id);
s = await waitUi((x) => x.weapons.length === 3 && x.weapons.some((w) => w.none));
ord = order(p);
const bi = ord.findIndex((w) => w.id === bow.id);
si = ord.findIndex((w) => w.id === spear.id);
check(s.weapons.length === 3 && s.weaponPh.length === 0 && s.weapons[bi]?.none && s.weapons[bi].label.startsWith(bow.name), `the bow gets a slot, dimmed while the shield is worn; no placeholders left (${JSON.stringify(s.weapons)})`);
await page.keyboard.press("Digit1"); await sleep(200);
n = await mark();
await clickWeapon(bi);
await sleep(600);
p = await hero();
sent = await sentSince(n);
s = await ui();
const t5 = await toasts();
check(sent.some((m) => m.type === "equipItem" && m.itemId === bow.id) && /A bow needs both hands/.test(t5), `clicking the bow asks the server, which refuses with its message (${t5.slice(-160)})`);
check(p.equipment.offhand?.id === shield.id && p.equipment.weapon?.id === spear.id && s.toolOn === 1, `refused bow: the shield and the spear stay, the tool stays in hand (offhand ${p.equipment.offhand?.name}, weapon ${p.equipment.weapon?.name}, tool ${s.toolOn})`);
await esc();
s = await ui();
check(s.toolOn === 0 && s.weapons[si].on, "Esc puts the tool away: the spear slot is lit");
// 0 skips the blocked bow.
const nextAfterSpear = ord[(si + 1) % 3].id === bow.id ? ord[(si + 2) % 3] : ord[(si + 1) % 3];
await page.keyboard.press("Digit0");
p = await until((q) => q.equipment.weapon?.id === nextAfterSpear.id);
check(p.equipment.weapon?.id === nextAfterSpear.id, `0 skips the bow while a shield is worn (wielded ${p.equipment.weapon?.name})`);

// ---- 6. spells in the hotbar -----------------------------------------------------------------------------------
await hook("grantSpell", { spellId: "heal" });
s = await waitUi((x) => shownSpells(x).length === 1);
check(shownSpells(s).length === 1 && spellPh(s).length === 3 && s.spellBtns[0].label === "Heal (Shift+1 or F1)", `one spell learnt: Heal fills slot 1, three placeholders left (${JSON.stringify(s.spellBtns.map((b) => [b.kbd, b.disabled]))})`);
for (const spellId of ["fireBolt", "thunder", "frost"]) await hook("grantSpell", { spellId });
s = await waitUi((x) => shownSpells(x).length === 4);
check(twoRows(s) && s.spellBarInHotbar && s.spellBarVisible && shownSpells(s).length === 4 && spellPh(s).length === 0 && s.spellBtns.every((b) => b.inHotbar), `4 learnt spells show in the hotbar (${JSON.stringify(s.spellBtns.map((b) => [b.label, b.shown, b.inHotbar]))})`);
check(s.spellBtns.length === 4 && s.spellBtns.every((b) => b.inHotbar) && (await page.evaluate(() => document.querySelectorAll("#spell-bar").length)) === 1, "one set of spell buttons only, all in the hotbar (no standalone spell bar)");
check(shownSpells(s).map((b) => b.kbd).join(" ") === "⇧1 ⇧2 ⇧3 ⇧4" && /Heal \(Shift\+1 or F1\)/.test(s.spellBtns[0].label ?? ""), `spell hotkey labels and aria labels (${JSON.stringify(s.spellBtns.map((b) => [b.kbd, b.label]))})`);
const sbRect = await rect("#spell-bar"), slotsRect = await rect("#hero-hotbar .hh-top");
check(sbRect && slotsRect && sbRect.t >= slotsRect.t - 1 && sbRect.b <= slotsRect.b + 1, `the spell group sits inside the top row (${JSON.stringify({ sbRect, slotsRect })})`);
await bothSizes("3-three-weapons-four-spells-weapon-active");
// The same with the Stockpile panel closed (the hero bar moves left; the hotbar fits between it and the minimap).
await page.click("#economy-panel-toggle"); await sleep(500);
check(await page.evaluate(() => document.getElementById("economy-panel").classList.contains("collapsed")), "the Stockpile panel closes");
await bothSizes("3b-stockpile-closed");
await page.click("#economy-panel-toggle"); await sleep(500);
// Click a spell: aim; Esc cancels only the aim; a second Esc readies the weapon (tool put away).
await page.keyboard.press("Digit1"); await sleep(200);
await page.locator(".spell-btn").nth(1).click(); await sleep(300);
s = await ui();
check(s.spellBtns[1].aiming && s.cursor === "crosshair" && s.toolOn === 1, "clicking Fire Bolt enters aim (crosshair), the tool stays armed");
await esc();
s = await ui();
check(!s.spellBtns.some((b) => b.aiming) && s.cursor !== "crosshair" && s.toolOn === 1, "Esc cancels only the aim (tool still armed)");
await esc();
s = await ui();
check(s.toolOn === 0 && s.weapons.some((w) => w.on), "a second Esc readies the weapon (tool away, weapon slot lit)");
await page.keyboard.press("Shift+Digit3"); await sleep(250);
check((await ui()).spellBtns[2].aiming, "Shift+3 aims Thunder");
await esc();
await page.keyboard.press("F2"); await sleep(250);
check((await ui()).spellBtns[1].aiming, "F2 aims Fire Bolt");
await esc();
await page.keyboard.press("F4"); await sleep(250);
check((await ui()).spellBtns[3].aiming, "F4 aims Frost");
await esc();
check(!(await ui()).spellBtns.some((b) => b.aiming), "Esc cancels the F4 aim");
// Casting with a tool armed: Heal on yourself (Shift+1 twice), then the cooldown overlay.
await page.keyboard.press("Digit1"); await sleep(200);
n = await mark();
await page.keyboard.press("Shift+Digit1"); await sleep(200);
await page.keyboard.press("Shift+Digit1"); await sleep(600);
sent = await sentSince(n);
s = await ui();
check(sent.some((m) => m.type === "castSpell" && m.slot === 0) && s.toolOn === 1, `Shift+1 twice casts Heal on yourself with a tool armed (${JSON.stringify(sent)})`);
check(parseFloat(s.spellBtns[0].cd) > 0, `Heal shows its cooldown overlay (${s.spellBtns[0].cd})`);
n = await mark();
await page.keyboard.press("F1"); await sleep(300);
check(!(await sentSince(n)).some((m) => m.type === "castSpell") && /Heal: \d+ s cooldown/.test(await toasts()), "F1 on cooldown: a cooldown toast, no cast");
await bothSizes("4-tool-armed-spell-cooldown");
await esc();
// Casting with a weapon wielded and no tool: Fire Bolt aim works too.
await page.keyboard.press("Shift+Digit2"); await sleep(250);
check((await ui()).spellBtns[1].aiming && (await ui()).toolOn === 0, "with the weapon ready, Shift+2 aims Fire Bolt");
await esc();
await bothSizes("5-weapon-active-spell-cooldown");

// ---- 7. strategy view: only the spell group shows, where the old spell bar sat (above the command bar / cards) --------
await page.click("#strategy-btn"); await sleep(1200);
const strat = await page.evaluate(() => document.body.classList.contains("strategy-mode"));
s = await ui();
const sbS = await rect("#spell-bar"), toolsS = await rect("#hero-hotbar .hh-tools"), cmdS = await rect("#command-bar"), cardsS = await rect("#regiment-cards");
check(strat && s.spellBarVisible && shownSpells(s).length === 4 && !toolsS && !overlap(sbS, cmdS) && !overlap(sbS, cardsS),
  `strategy view: the 4 spells show alone, clear of the command bar / regiment cards (${JSON.stringify({ strat, sbS, cmdS, cardsS, tools: !!toolsS })})`);
await page.keyboard.press("Shift+Digit2"); await sleep(250);
check((await ui()).spellBtns[1].aiming, "strategy view: Shift+2 still aims Fire Bolt");
await esc();
await page.screenshot({ path: path.join(OUT, "6-strategy-1280x800.png") });
await page.click("#strategy-btn"); await sleep(1200);
check(!(await page.evaluate(() => document.body.classList.contains("strategy-mode"))) && twoRows(await ui()), "back in adventure view both rows show again");

// ---- 8. -------------------------------------------------------------------------------------------------------------
check(pageErrors.length === 0, `no page errors (${JSON.stringify(pageErrors)})`);
await browser.close();
cleanup();
const failed = results.filter((r) => !r.ok);
writeFileSync(path.join(OUT, "result.json"), JSON.stringify({ when: new Date().toISOString(), results, pageErrors }, null, 1));
writeFileSync(path.join(OUT, "server.log"), serverLog);
console.log(`hotbar-smoke: ${results.length - failed.length}/${results.length} passed (out ${OUT})`);
console.log(failed.length ? "FAIL" : "PASS");
process.exit(failed.length ? 1 : 0);
