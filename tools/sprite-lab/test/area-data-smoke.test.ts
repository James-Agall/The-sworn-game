// Headless-browser smoke test of the Area tab's stage B kinds on a scratch copy (LAB_ROOT with the game's data folders,
// the interiors and the tile art; the scratch root is made a git repo so "diff vs git HEAD" has a HEAD): for each new
// kind open a built-in, edit, see the game's validator react, save into the scratch root, reload and find the edit.
// Sites (duplicate, paint + auto tier, the Tiers grid, garrison, real stamper preview), the Castle Ruin (the boss rule),
// a POI pool (reorder by drag, add, invalid count, world-gen samples), an interior (the red banner, paint a layout,
// buildInteriorMap preview, diff vs HEAD, save the built-in file after the confirm). Zero console errors.
// Screenshots go to $LAB_SHOTS (default: the session scratchpad), never into the repo.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { startLab, type Lab } from "../server/lab.ts";
import { loadArea } from "../server/game.ts";
import { INTERIORS_REL, REPO_DIR, scratchRoot } from "./helpers.ts";

const SCRATCH = "/tmp/claude-1000/-home-james/e750a2dc-86fa-43ba-992d-dfa7a0e3a701/scratchpad";
const PW_PKG = process.env.LAB_PLAYWRIGHT_PKG || "/home/james/projects/auto-loan-ff-release/package.json";
const CHROME = process.env.LAB_CHROME || `${SCRATCH}/pw-browsers/chromium-1234/chrome-linux64/chrome`;
const SHOTS = process.env.LAB_SHOTS || `${SCRATCH}/lab-shots`;
const PORT = 31864;

type Any = any;
let lab: Lab, root: string, browser: Any;

before(async () => {
  assert.ok(existsSync(PW_PKG), `Playwright package not found at ${PW_PKG} (set LAB_PLAYWRIGHT_PKG)`);
  assert.ok(existsSync(CHROME), `Chromium not found at ${CHROME} (set LAB_CHROME)`);
  mkdirSync(SHOTS, { recursive: true });
  root = await scratchRoot({ sprites: true, templates: true, areaArt: true });
  const git = (...a: string[]) => execFileSync("git", ["-C", root, ...a], { stdio: "pipe", env: { PATH: process.env.PATH || "", HOME: root, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git("init", "-q"); git("add", INTERIORS_REL); git("commit", "-q", "-m", "base");
  lab = await startLab({ root, port: PORT, vite: true });
  const { chromium } = createRequire(PW_PKG)("playwright");
  browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
});
after(async () => {
  await browser?.close();
  await lab?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

test("Area stage B smoke: sites, castle ruin, POI pool, interiors (edit, validate, preview, save, reload)", { timeout: 300_000 }, async () => {
  const A = await loadArea();
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errors: string[] = [];
  page.on("console", (m: Any) => { if (m.type() === "error") errors.push(`console: ${m.text()} @ ${m.location()?.url || ""}`); });
  page.on("pageerror", (e: Any) => errors.push("pageerror: " + e.message));
  page.on("response", (r: Any) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  const dbg = () => page.evaluate(() => (window as Any).__area.debug());
  const cell = async (x: number, y: number) => {
    const d = await dbg(), box = await page.locator("#area-canvas canvas").boundingBox();
    return { x: box.x + d.panX + (x + 0.5) * d.zoom, y: box.y + d.panY + (y + 0.5) * d.zoom };
  };
  const clickCell = async (x: number, y: number, button: "left" | "right" = "left") => { const p = await cell(x, y); await page.mouse.click(p.x, p.y, { button }); };
  const waitFn = (fn: string, timeout = 15_000) => page.waitForFunction(fn, null, { timeout });
  const modal = async (id: string) => {
    await page.waitForSelector(".modal-form input[name=id]");
    await page.fill(".modal-form input[name=id]", id);
    await page.click(".modal-form button[type=submit]");
  };
  const valid = () => waitFn(`/Valid/.test(document.querySelector("#area-val-head")?.textContent || "")`, 5000);
  const invalid = () => waitFn(`/error/.test(document.querySelector("#area-val-head")?.textContent || "")`, 5000);
  const saved = () => waitFn(`!window.__area.dirty && window.__area.debug().doc?.src === "user"`);
  const open = async (kind: string, id: string) => {
    await page.click(`.kindbtn[data-kind="${kind}"]`);
    await page.click(`.area-item[data-id="${id}"]`);
    await waitFn(`window.__area.debug().doc?.t.id === "${id}"`);
  };
  const find = (rows: string[], ch: string) => { for (let y = 0; y < rows.length; y++) { const x = rows[y].indexOf(ch); if (x >= 0) return { x, y }; } throw new Error("no " + ch); };

  await page.goto(lab.url);
  await page.waitForSelector("body[data-ready='1']", { timeout: 30_000 });
  await page.click("#tab-area");

  // ---- SITES: a built-in is read-only; painting duplicates it; a new cell joins at tier 1; the Tiers grid; garrison
  await open("sites", "thornwick");
  let d = await dbg();
  assert.equal(d.doc.src, "builtin");
  assert.equal(await page.isDisabled("#area-save"), true);
  const site0: string[] = d.doc.t.rows;
  const free = { x: 2, y: 1 };
  assert.equal(site0[free.y][free.x], ".");
  await page.click('.area-sym[data-ch="H"]');
  await clickCell(free.x, free.y);
  await modal("smoke-fort");
  await waitFn(`window.__area.debug().doc?.t.id === "smoke-fort"`);
  assert.match(await page.textContent("#area-databanner"), /Not used by world-gen yet/);
  await clickCell(free.x, free.y);
  await page.waitForTimeout(300);
  d = await dbg();
  assert.equal(d.doc.t.rows[free.y][free.x], "H");
  assert.equal(d.doc.t.tiers[free.y][free.x], "1", "a new cell joins at tier 1");
  await page.click('.layerbtn[data-layer="tiers"]');
  await page.click('.area-sym[data-ch="3"]');
  await clickCell(free.x, free.y);
  await page.waitForTimeout(300);
  d = await dbg();
  assert.equal(d.doc.t.tiers[free.y][free.x], "3");
  assert.equal(d.doc.t.rows[free.y][free.x], "H", "the Tiers grid leaves the tiles alone");
  await page.click('.layerbtn[data-layer="rows"]');
  // erase the keep: the game's validator complains; undo
  const k = find(site0, "K");
  await clickCell(k.x, k.y, "right");
  await invalid();
  assert.match(await page.textContent("#area-val"), /exactly one keep K \(has 0\)/);
  await page.screenshot({ path: `${SHOTS}/stageb-site-error.png` });
  await page.keyboard.press("Control+z");
  await valid();
  // garrison: 2 archers instead of 3 (a form field = one undo step)
  await page.fill('[data-key="garrison.banditArcher"]', "2");
  await page.press('[data-key="garrison.banditArcher"]', "Tab");
  await page.waitForTimeout(300);
  assert.equal((await dbg()).doc.t.garrison.banditArcher, 2);
  await valid();
  await page.screenshot({ path: `${SHOTS}/stageb-site-edited.png` });
  // the real server stamper at tier 1
  await page.click("#area-preview");
  await page.click('[data-tier="1"]');
  await waitFn(`/stampSiteTemplate\\), tier 1/.test(document.querySelector("#area-stats")?.textContent || "")`, 60_000);
  assert.match(await page.textContent("#area-stats"), /7 garrison spawned/);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/stageb-site-stamp.png` });
  await page.keyboard.press("v");
  await page.keyboard.press("Control+s");
  await saved();
  let file = JSON.parse(await readFile(path.join(root, "server/data/sites/user/smoke-fort.json"), "utf8"));
  assert.equal(file.rows[free.y][free.x], "H"); assert.equal(file.tiers[free.y][free.x], "3"); assert.equal(file.garrison.banditArcher, 2);
  assert.deepEqual(A.validateSiteTemplate(file, { mobKinds: A.MOB_KINDS }), []);
  assert.equal(await readFile(path.join(root, "server/data/sites/user/smoke-fort.json"), "utf8"), A.formatTemplate(A.normalise("sites", file)));

  // ---- CASTLE RUIN: the boss is unique and must be the centre
  await open("castle-ruins", "castle-ruin");
  await page.click("#area-dup-banner");
  await modal("smoke-castle");
  await waitFn(`window.__area.debug().doc?.t.id === "smoke-castle"`);
  await page.click('.area-sym[data-ch="B"]');
  await clickCell(2, 2);
  await invalid();
  d = await dbg();
  assert.equal(d.doc.t.rows.join("").split("B").length - 1, 1, "B moved (exactly one)");
  assert.match(await page.textContent("#area-val"), /must be at the centre \(is at 2,2\)/);
  await page.keyboard.press("Control+z");
  await valid();
  await page.fill('[data-key="guardians0"]', "5");
  await page.press('[data-key="guardians0"]', "Tab");
  await page.waitForTimeout(300);
  await page.click("#area-preview");
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/stageb-castle-preview.png` });
  await page.keyboard.press("v");
  await page.keyboard.press("Control+s");
  await saved();
  file = JSON.parse(await readFile(path.join(root, "server/data/castle-ruins/user/smoke-castle.json"), "utf8"));
  assert.deepEqual(file.guardians, [5, 12]);

  // ---- POI POOL: a form (no grid); order by drag; add; an invalid count; world-gen samples
  await open("pois", "ruin");
  assert.equal(await page.isVisible("#area-canvas"), false);
  assert.match(await page.textContent("#area-poi-form"), /ORDER MATTERS/);
  await page.click('[data-list="extras"] [data-remove="1"]');
  await modal("smoke-ruin");
  await waitFn(`window.__area.debug().doc?.t.id === "smoke-ruin"`);
  await page.dragAndDrop('[data-list="extras"] .area-li[data-i="1"]', '[data-list="extras"] .area-li[data-i="0"]');
  await page.waitForTimeout(300);
  d = await dbg();
  assert.deepEqual(d.doc.t.extras, ["RuinRubble", "RuinStatue"], "dragged into a new order");
  await page.fill('[data-add="centerpieces"]', "RuinRubble");
  await page.click('[data-add="centerpieces"] + button');
  await page.waitForTimeout(200);
  assert.deepEqual((await dbg()).doc.t.centerpieces, ["RuinWall1", "RuinWall2", "RuinArch", "RuinRubble"]);
  await page.fill('[data-key="extraCount1"]', "9");
  await page.press('[data-key="extraCount1"]', "Tab");
  await invalid();
  assert.match(await page.textContent("#area-val"), /extraCount/);
  await page.fill('[data-key="extraCount1"]', "3");
  await page.press('[data-key="extraCount1"]', "Tab");
  await valid();
  await page.click("#area-poi-run");
  await waitFn(`window.__area.debug().poiSamples === 6`, 60_000);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/stageb-poi.png`, fullPage: true });
  await page.keyboard.press("Control+s");
  await saved();
  file = JSON.parse(await readFile(path.join(root, "server/data/pois/user/smoke-ruin.json"), "utf8"));
  assert.deepEqual(file.extras, ["RuinRubble", "RuinStatue"]);
  assert.deepEqual(file.extraCount, [0, 3]);

  // ---- INTERIORS: the built-in file itself (red banner), a layout edit, the game's preview, diff, save after confirm
  await open("interiors", "barn");
  assert.match(await page.textContent("#area-databanner"), /edits the game's built-in interiors.*restart the server and rebuild the client.*revert with git/);
  assert.equal(await page.isDisabled("#area-save"), true, "nothing to save yet");
  assert.match(await page.textContent("#area-path"), /shared\/src\/data\/interiors\/barn\.json/);
  await page.click('.layerbtn[data-layer="v1"]');
  d = await dbg();
  assert.equal(d.layer, "v1");
  const rows1: string[] = d.doc.t.variants[1].rows;
  // a floor cell where a barrel keeps the layout valid (picked with the game's validator)
  let spot = { x: -1, y: -1 };
  for (let y = 1; y < rows1.length - 1 && spot.x < 0; y++) for (let x = 1; x < rows1[0].length - 1 && spot.x < 0; x++) {
    if (rows1[y][x] !== ".") continue;
    const f = A.withGrid("interiors", d.doc.t, "v1", rows1.map((r, yy) => (yy === y ? r.slice(0, x) + "x" + r.slice(x + 1) : r)));
    if (A.interiorLayoutErrors(f as Parameters<typeof A.interiorLayoutErrors>[0], "v1").length === 0) spot = { x, y };
  }
  assert.ok(spot.x >= 0, "a free floor cell");
  await page.click('.area-sym[data-ch="x"]');
  await clickCell(spot.x, spot.y);
  await page.waitForTimeout(300);
  d = await dbg();
  assert.equal(d.doc.t.variants[1].rows[spot.y][spot.x], "x");
  assert.deepEqual(d.doc.t.variants[0], JSON.parse(await readFile(path.join(REPO_DIR, INTERIORS_REL, "barn.json"), "utf8")).variants[0], "other layouts untouched");
  // blocking the exit row makes the validator complain about this layout, with the cell outlined
  const mat = find(rows1, "E");
  await page.click('.area-sym[data-ch="#"]');
  await clickCell(mat.x, mat.y - 1);
  await invalid();
  d = await dbg();
  assert.ok(d.cellErrors.length > 0, "this layout's errors");
  await page.screenshot({ path: `${SHOTS}/stageb-interior-error.png` });
  await page.keyboard.press("Control+z");
  await valid();
  // the game's buildInteriorMap at level 1
  await page.click("#area-preview");
  await page.click('[data-level="1"]');
  await waitFn(`/buildInteriorMap\\("barn", level 1, variant 1/.test(document.querySelector("#area-stats")?.textContent || "")`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/stageb-interior-preview.png` });
  await page.keyboard.press("v");
  // diff vs git HEAD shows the barrel line
  await page.click("#area-diff");
  await page.waitForSelector("#area-diff-view .area-hunk");
  assert.match(await page.textContent("#area-diff-view"), /UNSAVED/);
  assert.equal(await page.locator("#area-diff-view .dl.add").count(), 1);
  await page.screenshot({ path: `${SHOTS}/stageb-interior-diff.png` });
  await page.click("#area-diff-close");
  // save: a confirm, then the scratch file changes (the real repo's never)
  await page.keyboard.press("Control+s");
  await page.waitForSelector(".modal-form");
  assert.match(await page.textContent(".modal-form"), /Write the GAME'S built-in file shared\/src\/data\/interiors\/barn\.json/);
  await page.click(".modal-form button[type=submit]");
  await waitFn(`!window.__area.dirty`);
  const barn = JSON.parse(await readFile(path.join(root, INTERIORS_REL, "barn.json"), "utf8"));
  assert.equal(barn.variants[1].rows[spot.y][spot.x], "x");
  assert.deepEqual(A.validateInteriorFile(barn), []);
  assert.equal(await readFile(path.join(root, INTERIORS_REL, "barn.json"), "utf8"), JSON.stringify(A.normaliseInteriorFile(barn), null, 2) + "\n");
  assert.notEqual(await readFile(path.join(REPO_DIR, INTERIORS_REL, "barn.json"), "utf8"), await readFile(path.join(root, INTERIORS_REL, "barn.json"), "utf8"), "only the scratch root was written");
  await open("interiors", "hall");
  for (const p of A.HALL_REQUIRED_PROPS) assert.equal(await page.isDisabled(`[data-prop="${p}"]`), true, p + " locked");
  await page.screenshot({ path: `${SHOTS}/stageb-interior-hall.png` });

  // ---- reload: every saved edit comes back
  await page.reload();
  await page.waitForSelector("body[data-ready='1']", { timeout: 30_000 });
  await page.click("#tab-area");
  await open("sites", "smoke-fort");
  d = await dbg();
  assert.equal(d.doc.src, "user"); assert.equal(d.doc.t.tiers[free.y][free.x], "3");
  await open("pois", "smoke-ruin");
  assert.deepEqual((await dbg()).doc.t.extras, ["RuinRubble", "RuinStatue"]);
  await open("castle-ruins", "smoke-castle");
  assert.deepEqual((await dbg()).doc.t.guardians, [5, 12]);
  await open("interiors", "barn");
  await page.click('.layerbtn[data-layer="v1"]');
  assert.equal((await dbg()).doc.t.variants[1].rows[spot.y][spot.x], "x");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/stageb-interior-reloaded.png` });
  assert.deepEqual((await dbg()).artErrors, []);

  assert.deepEqual(errors, [], "console errors:\n" + errors.join("\n"));
  await page.close();
});
