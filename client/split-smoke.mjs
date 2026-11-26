#!/usr/bin/env node
// main.ts split regression net (2026-11-26, see SPLIT-PLAN-2026-11-26.md). Not part of `npm test` (the runner
// only picks up *-test.mjs): it needs Playwright + a Chromium from outside the repo and takes ~1 minute.
//
//   node client/split-smoke.mjs --out <scratch dir> [--port 31870] [--baseline <dir of an earlier run>]
//
// It builds the client (vite, --outDir <out>/dist, VITE_SERVER_URL baked to the private port), boots a private server
// (scratch COLONY_SAVE_DIR, COLONY_TEST_HOOKS=1, world 160, seed 42), serves the build on port+1, drives a Creative
// game through a checklist (HUD, minimap, inventory sheet, build a House, strategy view, pause, panels, Town Center
// interior, ground drop, wheel zoom, context menu, shortcuts), and writes <out>/result.json + step screenshots.
// With --baseline it compares the console/page errors, failed requests, the per-step DOM/state dumps and the
// screenshots (tolerant pixel diff) against that earlier run and exits 1 on a regression.
// Env: PW_MODULE_FROM (package.json whose node_modules has playwright), PW_CHROME (chromium binary).
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, createReadStream, statSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const OUT = path.resolve(arg("out", mkdtempSync(path.join(os.tmpdir(), "split-smoke-"))));
const PORT = Number(arg("port", "31870"));
const WEB_PORT = PORT + 1;
const BASELINE = arg("baseline", null);
const SKIP_BUILD = args.includes("--no-build");
const RUNNING_STEPS = new Set(["unpause", "repause", "build-house", "final"]);
const PIXEL_TOLERANCE = Number(arg("tolerance", "0.005")); // fraction of pixels allowed to differ per screenshot
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
const saveDir = mkdtempSync(path.join(os.tmpdir(), "split-smoke-saves-"));
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

// --- static server for the build --------------------------------------------------------------------------------
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".svg": "image/svg+xml", ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".webp": "image/webp", ".woff2": "font/woff2" };
const web = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  let file = path.join(DIST, url === "/" ? "index.html" : url);
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
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().replace(/:\d+:\d+/g, "")); });
page.on("pageerror", (e) => pageErrors.push(String(e.message)));
page.on("requestfailed", (r) => failedRequests.push(`${r.url().replace(/^https?:\/\/[^/]+/, "")} ${r.failure()?.errorText}`));
page.on("response", (r) => { if (r.status() >= 400) failedRequests.push(`${r.url().replace(/^https?:\/\/[^/]+/, "")} ${r.status()}`); });
await page.addInitScript(() => {
  try { localStorage.setItem("sworn.mapSize", "160"); } catch {}
  const Native = window.WebSocket;
  window.__sent = [];
  window.__recv = { types: {}, tileUpdates: [], ground: null, interior: null };
  window.WebSocket = class extends Native {
    constructor(...a) {
      super(...a);
      window.__ws = this;
      const send = this.send.bind(this);
      this.send = (data) => { try { window.__sent.push(JSON.parse(data).type); } catch {} return send(data); };
      this.addEventListener("message", (ev) => {
        if (typeof ev.data !== "string") return;
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        window.__recv.types[m.type] = (window.__recv.types[m.type] ?? 0) + 1;
        // Freeze the world as early as possible (the first snapshot of the game) so every run shows the same scene.
        if (m.type === "snapshot" && !window.__frozen) { window.__frozen = true; send(JSON.stringify({ type: "pause", paused: true })); }
        if (m.type === "tileUpdate") window.__recv.tileUpdates.push([m.tileX, m.tileY, m.tile]);
        if (m.type === "event") (window.__recv.events ??= []).push(m.text);
        if (m.type === "snapshot" && m.groundItems !== undefined) window.__recv.ground = m.groundItems;
        if (m.type === "testHookResult") window.__recv["hook_" + m.op] = m;
      });
    }
  };
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const steps = [];
const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); };
const send = (msg) => page.evaluate((m) => window.__ws.send(JSON.stringify(m)), msg);
const hook = async (op, extra = {}) => {
  await page.evaluate((op) => { delete window.__recv["hook_" + op]; }, op);
  await send({ type: "testHook", op, ...extra });
  await page.waitForFunction((op) => window.__recv["hook_" + op], op, { timeout: 15000 });
  return page.evaluate((op) => window.__recv["hook_" + op], op);
};
const visible = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return !e.hidden && cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0; }, sel);
// DOM/state dump: panel visibility, HUD texts that don't depend on wall-clock timing, toolbar shape, body classes.
const dump = () => page.evaluate(() => {
  const vis = (s) => { const e = document.querySelector(s); if (!e) return null; const cs = getComputedStyle(e); return !e.hidden && cs.display !== "none" && cs.visibility !== "hidden"; };
  const txt = (s) => document.querySelector(s)?.textContent?.trim().replace(/\s+/g, " ") ?? null;
  const panels = ["#hero-modal", "#quest-panel", "#work-panel", "#chronicle-panel", "#building-panel", "#trade-panel", "#craft-panel", "#save-panel", "#demolish-confirm", "#game-over", "#minimap-frame", "#minimap", "#colony-stats", "#hero-bar", "#spell-bar", "#boss-bar", "#player-bar", "#goal-tracker", "#build-panel", "#economy-panel", "#regiment-cards", "#settings-modal", "#main-menu", "#loading-screen", "#heir-picker", "#person-card"];
  return {
    vis: Object.fromEntries(panels.map((p) => [p, vis(p)])),
    text: Object.fromEntries(["#pause-btn", "#strategy-btn", "#stat-pop", "#stat-settlements", "#stat-difficulty", "#qp-title", "#wp-title", "#cp-title", "#hs-title", "#bp-name", "#hb-name", "#build-requirements", "#stat-selected"].map((s) => [s, txt(s)])),
    bodyClass: [...document.body.classList].sort().join(" "),
    toolbar: document.querySelectorAll("#toolbar .tool-btn").length,
    toolSelected: document.querySelector("#toolbar .tool-btn.selected")?.textContent?.trim() ?? null,
    tabs: [...document.querySelectorAll("#build-category-tabs .category-tab")].map((b) => b.textContent + (b.classList.contains("selected") ? "*" : "")).join("|"),
    hsTabs: [...document.querySelectorAll("#hs-tabs button")].map((b) => b.textContent).join("|"),
    canvases: [...document.querySelectorAll("canvas")].map((c) => `${c.id || "?"}:${c.width}x${c.height}`).join(" "),
    colonyHeader: !!document.getElementById("colony-header"),
    cssVars: ["--toolbar-bottom", "--colony-header-bottom"].map((v) => document.documentElement.style.getPropertyValue(v)).join(" "),
  };
});
async function step(name, fn) {
  let error = null;
  const sentBefore = await page.evaluate(() => window.__sent.length);
  try { await fn(); } catch (e) { error = String(e?.message ?? e); failures.push(`${name}: ${error}`); }
  await sleep(700);
  const sentTypes = await page.evaluate((n) => [...new Set(window.__sent.slice(n))].sort(), sentBefore);
  const shot = path.join(OUT, `${String(steps.length).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: shot });
  steps.push({ name, error, sent: sentTypes.filter((t) => t !== "input" && t !== "viewport" && t !== "strategyView" && t !== "requestChunks"), dump: await dump(), shot: path.basename(shot) });
}

const t0 = Date.now();
await page.goto(`http://127.0.0.1:${WEB_PORT}/?mode=creative`);
await page.getByRole("button", { name: "New Game (Creative)" }).or(page.locator("#menu-creative")).first().click();
await page.waitForFunction(() => window.__ws && window.__ws.readyState === 1, null, { timeout: 120000 });
await page.waitForFunction(() => { const l = document.getElementById("loading-screen"); return (window.__recv.types.snapshot ?? 0) > 5 && (!l || l.hidden || getComputedStyle(l).display === "none"); }, null, { timeout: 180000 });
await sleep(4000);
const loadMs = Date.now() - t0;
await send({ type: "pause", paused: true });
await sleep(1500);

await step("initial", async () => {
  check(await visible("#colony-stats"), "HUD #colony-stats visible");
  check(await visible("#minimap"), "minimap visible");
  check(await page.evaluate(() => document.querySelectorAll("#app canvas").length >= 1), "pixi canvas present");
});
await step("inventory-open", async () => {
  await page.keyboard.press("Backquote");
  await sleep(400);
  check(await visible("#hero-modal"), "` opens the inventory sheet");
});
await step("family-tab", async () => {
  const tab = page.locator("#hs-tabs button", { hasText: /family|life/i }).first();
  if (await tab.count()) await tab.click();
});
await step("inventory-close", async () => {
  await page.keyboard.press("Escape");
  await sleep(300);
  check(!(await visible("#hero-modal")), "Escape closes the inventory sheet");
  await page.keyboard.press("Backquote");
  await sleep(300);
  check(await visible("#hero-modal"), "` opens the sheet again");
  await page.click("#hs-close");
  await sleep(300);
  check(!(await visible("#hero-modal")), "close button closes the sheet");
});
await step("strategy-on", async () => {
  await page.keyboard.press("Tab");
  await sleep(800);
});
await step("strategy-off", async () => {
  await page.keyboard.press("Tab");
  await sleep(800);
});
for (const [btn, panel, close] of [["#quests-btn", "#quest-panel", "#qp-close"], ["#work-btn", "#work-panel", "#wp-close"], ["#chronicle-btn", "#chronicle-panel", "#cp-close"]]) {
  await step(`open-${btn.slice(1)}`, async () => {
    await page.click(btn);
    await sleep(400);
    check(await visible(panel), `${btn} opens ${panel}`);
  });
  await step(`close-${btn.slice(1)}`, async () => {
    await page.click(close);
    await sleep(300);
    check(!(await visible(panel)), `${close} closes ${panel}`);
  });
}
await step("interior-enter", async () => {
  const tcTile = await hook("interior", { find: 12 /* TileType.TownCenter */ });
  const found = (tcTile.found ?? [])[0];
  const r = found ? await hook("interior", { enter: { tx: found.tx, ty: found.ty } }) : null;
  steps.interiorWhy = r?.why ?? "no Town Center found";
  await sleep(1500);
});
await step("interior-leave", async () => {
  await send({ type: "interiorExit" });
  await sleep(1500);
});
await step("ground-drop", async () => {
  await hook("heroLife", { pack: { wood: 5 } });
  await sleep(300);
  await page.keyboard.press("Backquote");
  await sleep(500);
  const drop = page.locator("#hs-goods button[data-drop]").first();
  check((await drop.count()) > 0, "inventory shows a drop button for carried goods");
  if (await drop.count()) await drop.click();
  await sleep(600);
  const g = await hook("groundItems", {});
  check(JSON.stringify(g).includes("wood"), "dropped wood is on the ground (groundItems hook)");
  steps.groundHook = g.stacks?.length ?? g.items?.length ?? null;
  await page.keyboard.press("Escape");
});
await step("wheel-zoom", async () => {
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, -600);
  await sleep(600);
});
await step("wheel-unzoom", async () => {
  await page.mouse.wheel(0, 600);
  await sleep(600);
});
await step("context-menu", async () => {
  const prevented = await page.evaluate(() => {
    const c = document.querySelector("#app canvas");
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 600, clientY: 380 });
    c.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  steps.contextMenuPrevented = prevented;
});
await step("time-keys", async () => {
  await page.keyboard.press("BracketRight");
  await sleep(300);
  await page.keyboard.press("BracketLeft");
  await sleep(300);
});
await step("unpause", async () => {
  await page.click("#pause-btn");
  await sleep(500);
});
await step("repause", async () => {
  await page.click("#pause-btn");
  await sleep(500);
});
await step("build-house", async () => {
  await page.evaluate(() => { window.__recv.tileUpdates.length = 0; });
  // The build panel can sit outside the viewport (collapsed drawer): click the House tool through the DOM.
  const label = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("#toolbar .tool-btn")].find((b) => /^Cottage/.test(b.textContent.trim()));
    btn?.click();
    return btn?.textContent ?? null;
  });
  check(!!label, "the build menu has a Cottage tool");
  await sleep(200);
  // The build lands on the next tick: run the world for the placement (last steps, so the drift doesn't matter).
  await send({ type: "pause", paused: false });
  // Fixed seed, fixed spots: the first free one takes the Cottage (the same one every run).
  for (const [dx, dy] of [[2, 1], [-2, 1], [0, 2], [1, 2], [-1, 2], [2, 0], [-2, 0], [2, -2], [-2, -2]]) {
    await page.mouse.move(640 + 32 * dx, 400 + 32 * dy);
    await sleep(200);
    await page.mouse.click(640 + 32 * dx, 400 + 32 * dy);
    const ok = await page.waitForFunction(() => window.__recv.tileUpdates.length > 0, null, { timeout: 2500 }).then(() => true, () => false);
    if (ok) { steps.placedAt = [dx, dy]; break; }
  }
  steps.buildEvents = await page.evaluate(() => (window.__recv.events ?? []).slice(-6));
  const ups = await page.evaluate(() => window.__recv.tileUpdates.slice());
  check(ups.length > 0, "placing a Cottage sends a tileUpdate back");
  await send({ type: "pause", paused: true });
  await sleep(500);
  await page.keyboard.press("Escape");
});
await step("final", async () => {});

const recv = await page.evaluate(() => ({ types: Object.keys(window.__recv.types).sort(), tileUpdates: window.__recv.tileUpdates.length }));
await browser.close();
cleanup();

const result = {
  when: new Date().toISOString(), loadMs, failures, consoleErrors: [...new Set(consoleErrors)].sort(), pageErrors, failedRequests: [...new Set(failedRequests)].sort(),
  interiorWhy: steps.interiorWhy, placedAt: steps.placedAt, buildEvents: steps.buildEvents, groundHook: steps.groundHook, contextMenuPrevented: steps.contextMenuPrevented, recvTypes: recv.types,
  steps: steps.map((s) => ({ ...s })),
};

// --- compare against a baseline run -----------------------------------------------------------------------------
if (BASELINE) {
  const base = JSON.parse(readFileSync(path.join(BASELINE, "result.json"), "utf8"));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const regress = [];
  if (!same(base.consoleErrors, result.consoleErrors)) regress.push(`console errors differ: base ${JSON.stringify(base.consoleErrors)} now ${JSON.stringify(result.consoleErrors)}`);
  if (!same(base.pageErrors, result.pageErrors)) regress.push(`page errors differ: ${JSON.stringify(result.pageErrors)}`);
  if (!same(base.failedRequests, result.failedRequests)) regress.push(`failed requests differ: base ${base.failedRequests.length} now ${result.failedRequests.length}: ${JSON.stringify(result.failedRequests.filter((r) => !base.failedRequests.includes(r)))}`);
  if (!same(base.contextMenuPrevented, result.contextMenuPrevented)) regress.push("context menu behaviour differs");
  if (!same(base.recvTypes, result.recvTypes)) regress.push(`received message types differ: ${JSON.stringify(base.recvTypes)} vs ${JSON.stringify(result.recvTypes)}`);
  // Pixel diff in a fresh browser page (decodes both PNGs on a canvas).
  const b2 = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
  const p2 = await b2.newPage();
  const diffs = [];
  for (const s of result.steps) {
    const bs = base.steps.find((x) => x.name === s.name);
    if (!bs) { regress.push(`step ${s.name} missing in baseline`); continue; }
    if (!same(bs.dump, s.dump)) {
      const keys = Object.keys(s.dump).filter((k) => !same(bs.dump[k], s.dump[k]));
      regress.push(`step ${s.name}: DOM dump differs in ${keys.map((k) => `${k}: ${JSON.stringify(bs.dump[k])} -> ${JSON.stringify(s.dump[k])}`).join("; ")}`);
    }
    if (!same(bs.sent, s.sent)) regress.push(`step ${s.name}: sent messages differ ${JSON.stringify(bs.sent)} -> ${JSON.stringify(s.sent)}`);
    const a = readFileSync(path.join(BASELINE, bs.shot)).toString("base64");
    const b = readFileSync(path.join(OUT, s.shot)).toString("base64");
    const frac = await p2.evaluate(async ([a, b]) => {
      const load = async (d) => { const img = new Image(); img.src = "data:image/png;base64," + d; await img.decode(); const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const x = c.getContext("2d"); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
      const da = await load(a), db = await load(b);
      if (da.length !== db.length) return 1;
      let n = 0;
      const c = document.createElement("canvas"); c.width = 1280; c.height = 800;
      const x = c.getContext("2d"); const out = x.createImageData(1280, 800);
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 24;
        if (d) n++;
        out.data[i] = d ? 255 : da[i] / 3; out.data[i + 1] = d ? 0 : da[i + 1] / 3; out.data[i + 2] = d ? 0 : da[i + 2] / 3; out.data[i + 3] = 255;
      }
      x.putImageData(out, 0, 0);
      return [n / (da.length / 4), c.toDataURL("image/png").split(",")[1]];
    }, [a, b]).then(([f, png]) => { writeFileSync(path.join(OUT, `diff-${s.shot}`), Buffer.from(png, "base64")); return f; });
    diffs.push([s.name, +frac.toFixed(5)]);
    // The world is frozen (paused on its first snapshot) for every step up to "unpause"; from there it runs for a
    // moment (the Cottage needs a tick), so villagers wander differently each run: a looser tolerance there.
    const tol = RUNNING_STEPS.has(s.name) ? 0.03 : PIXEL_TOLERANCE;
    if (frac > tol) regress.push(`step ${s.name}: ${(frac * 100).toFixed(2)}% pixels differ (tolerance ${(tol * 100).toFixed(2)}%)`);
  }
  await b2.close();
  result.compare = { baseline: BASELINE, regress, pixelDiffs: diffs };
}
writeFileSync(path.join(OUT, "result.json"), JSON.stringify(result, null, 1));
writeFileSync(path.join(OUT, "server.log"), serverLog);
console.log(`split-smoke: out ${OUT}, load ${loadMs} ms, ${result.steps.length} steps`);
console.log(`  checklist failures: ${failures.length ? failures.join(" | ") : "none"}`);
console.log(`  console errors: ${result.consoleErrors.length}, page errors: ${pageErrors.length}, failed requests: ${result.failedRequests.length}`);
if (result.compare) {
  console.log(`  pixel diffs: ${result.compare.pixelDiffs.map(([n, f]) => `${n}=${(f * 100).toFixed(2)}%`).join(" ")}`);
  console.log(`  regressions vs baseline: ${result.compare.regress.length ? "\n    - " + result.compare.regress.join("\n    - ") : "none"}`);
}
const bad = failures.length > 0 || pageErrors.length > 0 || (result.compare && result.compare.regress.length > 0);
console.log(bad ? "FAIL" : "PASS");
process.exit(bad ? 1 : 0);
