// Headless-browser smoke test of the Area tab on a scratch copy (LAB_ROOT with the game's template folders and the tile
// art): open a built-in camp, "Duplicate to user", paint, see the game's validator react (and undo), save, reload and
// find the file in the scratch user/ folder; a settlement: duplicate, place a building from the library (collision
// highlight), turn the whole template, the stamp preview (shared code + the real server stamper); a building template.
// Zero console errors. Screenshots go to $LAB_SHOTS (default: the session scratchpad), never into the repo.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { startLab, type Lab } from "../server/lab.ts";
import { loadArea } from "../server/game.ts";
import { scratchRoot } from "./helpers.ts";

const SCRATCH = "/tmp/claude-1000/-home-james/e750a2dc-86fa-43ba-992d-dfa7a0e3a701/scratchpad";
const PW_PKG = process.env.LAB_PLAYWRIGHT_PKG || "/home/james/projects/auto-loan-ff-release/package.json";
const CHROME = process.env.LAB_CHROME || `${SCRATCH}/pw-browsers/chromium-1234/chrome-linux64/chrome`;
const SHOTS = process.env.LAB_SHOTS || `${SCRATCH}/lab-shots`;
const PORT = 31863;

type Any = any;
let lab: Lab, root: string, browser: Any;

before(async () => {
  assert.ok(existsSync(PW_PKG), `Playwright package not found at ${PW_PKG} (set LAB_PLAYWRIGHT_PKG)`);
  assert.ok(existsSync(CHROME), `Chromium not found at ${CHROME} (set LAB_CHROME)`);
  mkdirSync(SHOTS, { recursive: true });
  root = await scratchRoot({ sprites: true, templates: true, areaArt: true });
  lab = await startLab({ root, port: PORT, vite: true });
  const { chromium } = createRequire(PW_PKG)("playwright");
  browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
});
after(async () => {
  await browser?.close();
  await lab?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

test("Area tab smoke: camp duplicate / paint / validate / save / reload, settlement buildings + preview, building", { timeout: 240_000 }, async () => {
  const A = await loadArea();
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errors: string[] = [];
  page.on("console", (m: Any) => { if (m.type() === "error") errors.push(`console: ${m.text()} @ ${m.location()?.url || ""}`); });
  page.on("pageerror", (e: Any) => errors.push("pageerror: " + e.message));
  page.on("response", (r: Any) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  page.on("dialog", (d: Any) => d.accept());
  const dbg = () => page.evaluate(() => (window as Any).__area.debug());
  const cell = async (x: number, y: number) => {
    const d = await dbg(), box = await page.locator("#area-canvas canvas").boundingBox();
    return { x: box.x + d.panX + (x + 0.5) * d.zoom, y: box.y + d.panY + (y + 0.5) * d.zoom };
  };
  const clickCell = async (x: number, y: number, button: "left" | "right" = "left") => { const p = await cell(x, y); await page.mouse.click(p.x, p.y, { button }); };
  const waitDoc = (fn: string) => page.waitForFunction(fn, null, { timeout: 15_000 });
  const modal = async (id: string) => {
    await page.waitForSelector(".modal-form input[name=id]");
    await page.fill(".modal-form input[name=id]", id);
    await page.click(".modal-form button[type=submit]");
  };

  await page.goto(lab.url);
  await page.waitForSelector("body[data-ready='1']", { timeout: 30_000 });
  await page.click("#tab-area");
  await page.click('.kindbtn[data-kind="camps"]');
  await page.click('.area-item[data-id="t1-forest-camp"]');
  await waitDoc(`window.__area.debug().doc?.t.id === "t1-forest-camp"`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/area-camp-builtin.png` });
  let d = await dbg();
  assert.equal(d.doc.src, "builtin");
  assert.match(await page.textContent("#area-banner"), /read-only/);
  assert.equal(await page.isDisabled("#area-save"), true, "Save is off for a built-in");
  const builtinRows: string[] = d.doc.t.rows;

  // painting a built-in asks to duplicate it to a user id first
  await clickCell(0, 0);
  await modal("smoke-camp");
  await waitDoc(`window.__area.debug().doc?.t.id === "smoke-camp"`);
  d = await dbg();
  assert.equal(d.doc.src, "new");
  assert.deepEqual(d.doc.t.rows, builtinRows, "the copy starts as the built-in");
  assert.match(await page.textContent("#area-path"), /server\/data\/camps\/user\/smoke-camp\.json/);

  // erase the hearth: the game's validator complains, Save is disabled; undo restores
  const h = G_find(builtinRows, "H");
  await clickCell(h.x, h.y, "right");
  await page.waitForFunction(() => /error/.test(document.querySelector("#area-val-head")?.textContent || ""), null, { timeout: 5000 });
  assert.match(await page.textContent("#area-val"), /exactly one hearth H \(has 0\)/);
  assert.equal(await page.isDisabled("#area-save"), true);
  await page.screenshot({ path: `${SHOTS}/area-camp-error.png` });
  await page.keyboard.press("Control+z");
  await page.waitForFunction(() => /Valid/.test(document.querySelector("#area-val-head")?.textContent || ""), null, { timeout: 5000 });

  // paint a crate at an open corner, a palisade line, then save
  const open = builtinRows[0][0] === "." ? { x: 0, y: 0 } : { x: builtinRows[0].length - 1, y: 0 };
  await page.click('.area-sym[data-ch="x"]');
  await clickCell(open.x, open.y);
  await page.waitForTimeout(400);
  d = await dbg();
  assert.equal(d.doc.t.rows[open.y][open.x], "x");
  assert.deepEqual(d.errors, [], d.errors.join("; "));
  await page.screenshot({ path: `${SHOTS}/area-camp-painted.png` });
  await page.keyboard.press("Control+s");
  await page.waitForFunction(() => (window as Any).__area.debug().doc?.src === "user" && !(window as Any).__area.dirty, null, { timeout: 15_000 });
  const file = path.join(root, "server/data/camps/user/smoke-camp.json");
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.equal(saved.rows[open.y][open.x], "x");
  assert.deepEqual(A.validateCampTemplate(saved), []);
  assert.equal(await readFile(file, "utf8"), A.formatTemplate(A.normalise("camps", saved)));

  // reload: the user template is listed and opens with the edit
  await page.reload();
  await page.waitForSelector("body[data-ready='1']", { timeout: 30_000 });
  await page.click("#tab-area");
  await page.selectOption("#area-src", "user");
  await page.click('.area-item[data-id="smoke-camp"]');
  await waitDoc(`window.__area.debug().doc?.t.id === "smoke-camp"`);
  d = await dbg();
  assert.equal(d.doc.src, "user");
  assert.equal(d.doc.t.rows[open.y][open.x], "x");
  assert.equal(await page.isDisabled("#area-save"), false);
  await page.selectOption("#area-src", "");

  // settlement: duplicate a built-in hamlet, place a building on a road (collision), undo, turn the whole template
  await page.click('.kindbtn[data-kind="settlements"]');
  await page.click('.area-item[data-id="hamlet-chapel"]');
  await waitDoc(`window.__area.debug().doc?.t.id === "hamlet-chapel"`);
  await page.click("#area-dup-banner");
  await modal("smoke-hamlet");
  await waitDoc(`window.__area.debug().doc?.t.id === "smoke-hamlet"`);
  d = await dbg();
  const nb = d.doc.t.buildings.length;
  const road = G_find(d.doc.t.rows, "_");
  await page.click('.area-lib[data-ref="house-hut"]');
  await clickCell(road.x, road.y);
  await page.waitForTimeout(400);                                   // validation is debounced
  d = await dbg();
  assert.equal(d.doc.t.buildings.length, nb + 1);
  assert.ok(d.warnings.some((w: string) => /collide/.test(w)), "collision is flagged");
  assert.ok(d.errors.length > 0, "the game's validator refuses a building on a road");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/area-settlement-collision.png` });
  await page.keyboard.press("Control+z");
  d = await dbg();
  assert.equal(d.doc.t.buildings.length, nb);
  await page.keyboard.press("Escape");
  await page.click("#area-rot");
  await page.waitForTimeout(400);
  d = await dbg();
  assert.deepEqual(d.errors, [], "turned 90: still valid: " + d.errors.join("; "));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/area-settlement-turned.png` });

  // stamp preview: shared code, then the real server stamper
  await page.click("#area-preview");
  await page.waitForSelector(".area-variant", { timeout: 10_000 });
  assert.ok((await page.locator(".area-variant").count()) >= 1);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/area-settlement-preview.png` });
  await page.selectOption("#area-prev-src", "server-stamper");
  await page.waitForFunction(() => /server stamper, seed/.test(document.querySelector("#area-stats")?.textContent || ""), null, { timeout: 60_000 });
  assert.match(await page.textContent("#area-banner"), /REAL server stamper/);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/area-settlement-real-stamp.png` });
  await page.keyboard.press("v");

  // a camp's real stamp: guards on slots
  await page.click('.kindbtn[data-kind="camps"]');
  await page.waitForSelector('.modal-form', { timeout: 5000 });          // unsaved settlement: discard?
  await page.click(".modal-form button[type=submit]");
  await page.click('.area-item[data-id="t2-palisade-ring"]');
  await waitDoc(`window.__area.debug().doc?.t.id === "t2-palisade-ring"`);
  await page.click("#area-preview");
  await page.selectOption("#area-prev-src", "server-stamper");
  await page.waitForFunction(() => /guard\(s\) spawned/.test(document.querySelector("#area-stats")?.textContent || ""), null, { timeout: 60_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/area-camp-real-stamp.png` });
  await page.keyboard.press("v");

  // a building template
  await page.click('.kindbtn[data-kind="buildings"]');
  await page.click('.area-item[data-id="house-cottage"]');
  await waitDoc(`window.__area.debug().doc?.t.id === "house-cottage"`);
  d = await dbg();
  assert.deepEqual(d.errors, []);
  const missing = d.coverage.filter((c: Any) => c.tile !== null && !c.art);
  assert.deepEqual(missing.map((c: Any) => c.ch), [], "every building symbol with a tile draws game art");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/area-building.png` });

  assert.deepEqual(errors, [], "console errors:\n" + errors.join("\n"));
  await page.close();
});

function G_find(rows: string[], ch: string): { x: number; y: number } {
  for (let y = 0; y < rows.length; y++) { const x = rows[y].indexOf(ch); if (x >= 0) return { x, y }; }
  throw new Error("no " + ch);
}
