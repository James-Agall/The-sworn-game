// ONE headless-browser smoke test of the whole Lab on a scratch copy (LAB_ROOT): every tab opens with zero console errors,
// a pivot edit survives save + reload, a part edited through the Piskel iframe is sent back and changes the PNG on disk,
// and the Rig tab plays, scrubs, keys a pose by dragging a gizmo, saves, reloads, exports a contact sheet and a bake.
// Screenshots go to $LAB_SHOTS (default: the session scratchpad), never into the repo.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { startLab, type Lab } from "../server/lab.ts";
import { scratchRoot } from "./helpers.ts";
import { validateClip } from "../shared/clip.ts";

const SCRATCH = "/tmp/claude-1000/-home-james/e750a2dc-86fa-43ba-992d-dfa7a0e3a701/scratchpad";
const PW_PKG = process.env.LAB_PLAYWRIGHT_PKG || "/home/james/projects/auto-loan-ff-release/package.json";
const CHROME = process.env.LAB_CHROME || `${SCRATCH}/pw-browsers/chromium-1234/chrome-linux64/chrome`;
const SHOTS = process.env.LAB_SHOTS || `${SCRATCH}/lab-shots`;
const PORT = 31861;

type Any = any;
let lab: Lab, root: string, browser: Any;

before(async () => {
  assert.ok(existsSync(PW_PKG), `Playwright package not found at ${PW_PKG} (set LAB_PLAYWRIGHT_PKG)`);
  assert.ok(existsSync(CHROME), `Chromium not found at ${CHROME} (set LAB_CHROME)`);
  mkdirSync(SHOTS, { recursive: true });
  root = await scratchRoot({ sprites: true });
  lab = await startLab({ root, port: PORT, vite: true });
  const { chromium } = createRequire(PW_PKG)("playwright");
  browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
});
after(async () => {
  await browser?.close();
  await lab?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

const SET = "client/public/rig/parts/grounded-v2";

test("Lab smoke: tabs, pivot save + reload, Draw round trip", { timeout: 180_000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  page.on("console", (m: Any) => { if (m.type() === "error") errors.push(`console: ${m.text()} @ ${m.location()?.url || ""}`); });
  page.on("pageerror", (e: Any) => errors.push("pageerror: " + e.message));
  page.on("response", (r: Any) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  page.on("dialog", (d: Any) => d.accept());

  await page.goto(lab.url);
  await page.waitForSelector("body[data-ready='1']", { timeout: 30_000 });
  assert.equal(await page.inputValue("#set-select"), "grounded-v2");

  // every tab
  for (const tab of ["parts", "draw", "rig", "area", "compare"]) {
    await page.click("#tab-" + tab);
    if (tab === "draw") await page.frameLocator("#piskel-frame").locator("#drawing-canvas-container").waitFor({ timeout: 30_000 });
    if (tab === "compare") await page.waitForSelector("#validator-summary", { timeout: 30_000 });
    await page.waitForTimeout(tab === "parts" ? 1200 : 1500);
    await page.screenshot({ path: `${SHOTS}/${tab}.png` });
  }
  const summary = await page.textContent("#validator-summary");
  assert.match(summary, /grounded-v2: (PASS|WARN)/);

  // Parts: edit a pivot, save, reload, see it
  await page.click("#tab-parts");
  await page.click('#part-list li[data-part="head"]');
  const oldX = Number(await page.inputValue("#f-pivot-x"));
  await page.fill("#f-pivot-x", String(oldX + 1.5));
  await page.press("#f-pivot-x", "Tab");
  await page.waitForSelector("#dirty.on");
  await page.click("#save");
  await page.waitForSelector("#dirty:not(.on)", { timeout: 15_000 });
  const onDisk = JSON.parse(await readFile(path.join(root, SET, "manifest.json"), "utf8"));
  assert.equal(onDisk.parts.head.pivot[0], oldX + 1.5);
  await page.reload();
  await page.waitForSelector("body[data-ready='1']", { timeout: 30_000 });
  await page.click("#tab-parts");
  await page.click('#part-list li[data-part="head"]');
  assert.equal(Number(await page.inputValue("#f-pivot-x")), oldX + 1.5);

  // Draw: open the part through the Piskel iframe, draw a stroke, send back, the PNG on disk changed
  const before = await readFile(path.join(root, SET, "head.png"));
  await page.click("#edit-in-draw");
  await page.waitForFunction(() => /editing head/.test(document.getElementById("draw-info")?.textContent || ""), null, { timeout: 30_000 });
  await page.frameLocator("#piskel-frame").locator("#loading-mask").waitFor({ state: "detached", timeout: 15_000 });
  const frameBox = await page.locator("#piskel-frame").boundingBox();
  const canvasBox = await page.frameLocator("#piskel-frame").locator("#drawing-canvas-container canvas").first().boundingBox();
  assert.ok(frameBox && canvasBox);
  const cx = canvasBox.x + canvasBox.width / 2, cy = canvasBox.y + canvasBox.height / 2;
  await page.mouse.move(cx - 40, cy - 10);
  await page.mouse.down();
  for (let i = 0; i <= 8; i++) { await page.mouse.move(cx - 40 + i * 10, cy - 10 + i * 3, { steps: 3 }); await page.waitForTimeout(30); }
  await page.mouse.up();
  await page.waitForFunction(() => /changed/.test(document.getElementById("draw-info")?.textContent || ""), null, { timeout: 10_000 });
  await page.screenshot({ path: `${SHOTS}/draw-edited.png` });
  await page.click("#send-back");
  await page.waitForFunction(() => !/changed/.test(document.getElementById("draw-info")?.textContent || ""), null, { timeout: 15_000 });
  const after = await readFile(path.join(root, SET, "head.png"));
  assert.notDeepEqual(after, before, "head.png should change after Send back");
  const m2 = JSON.parse(await readFile(path.join(root, SET, "manifest.json"), "utf8"));
  assert.equal(m2.parts.head.pivot[0], oldX + 1.5, "pivot kept by Send back");
  await page.click("#tab-parts");
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/parts-after-draw.png` });

  // ---------------- Rig tab
  await page.click("#tab-rig");
  await page.waitForSelector('#rig-clip-list li[data-clip="walk"]');
  const timeText = () => page.textContent("#rig-time");
  await page.click('#rig-clip-list li[data-clip="attack-sword"]');
  const t0 = await timeText();
  await page.click("#rig-play");
  await page.waitForTimeout(450);
  await page.click("#rig-play");                                        // pause
  assert.notEqual(await timeText(), t0, "playback moves the playhead");
  await page.screenshot({ path: `${SHOTS}/rig-play.png` });
  // scrub on the ruler to the middle
  const tl = await page.locator("#rig-timeline-canvas").boundingBox();
  assert.ok(tl);
  await page.mouse.move(tl.x + 140, tl.y + 6); await page.mouse.down();
  const mid = tl.x + 128 + 0.5 * (tl.width - 128 - 12);
  await page.mouse.move(mid, tl.y + 6, { steps: 6 }); await page.mouse.up();
  assert.match(await timeText(), /^u 0\.(49|50|51)/, "scrubbed to the middle: " + await timeText());
  // keyboard: arrow steps one frame, space plays / pauses
  const frameNo = async () => Number((await timeText()).match(/f (\d+)/)![1]);
  const f0 = await frameNo();
  await page.focus("#rig-canvas");
  await page.keyboard.press("ArrowRight");
  assert.equal(await frameNo(), f0 + 1, "Right arrow steps one frame");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await frameNo(), f0, "Left arrow steps back");
  // built-ins are read-only: duplicate walk, save it once unchanged
  await page.click('#rig-clip-list li[data-clip="walk"]');
  await page.click("#rig-dup");
  await page.fill(".modal-form input[name=name]", "walk-lab");
  await page.click(".modal-form button[type=submit]");
  await page.waitForSelector('#rig-clip-list li[data-clip="walk-lab"].sel');
  await page.waitForSelector("#rig-dirty.on");
  await page.keyboard.press("Control+s");
  await page.waitForSelector("#rig-dirty:not(.on)", { timeout: 15_000 });
  const CLIP = path.join(root, "client/public/rig/clips/walk-lab.json");
  const first = await readFile(CLIP, "utf8");
  // scrub to u 0.25, then drag the near hand gizmo: shoulder + elbow are keyed at the playhead
  await page.mouse.click(tl.x + 128 + 0.25 * (tl.width - 128 - 12), tl.y + 6);
  const handles = await page.evaluate(() => (window as Any).__labRig.handles());
  assert.ok(handles["armN.hand"], "near hand gizmo: " + JSON.stringify(Object.keys(handles)));
  const [hx, hy] = handles["armN.hand"];
  await page.mouse.move(hx, hy); await page.mouse.down();
  await page.mouse.move(hx + 30, hy - 40, { steps: 8 }); await page.mouse.up();
  await page.waitForSelector("#rig-dirty.on");
  await page.screenshot({ path: `${SHOTS}/rig-drag.png` });
  // undo / redo round trip through the header buttons
  await page.click("#undo"); await page.waitForSelector("#rig-dirty:not(.on)");
  await page.click("#redo"); await page.waitForSelector("#rig-dirty.on");
  await page.click("#rig-save");
  await page.waitForSelector("#rig-dirty:not(.on)", { timeout: 15_000 });
  const second = await readFile(CLIP, "utf8");
  assert.notEqual(second, first, "walk-lab.json changed after the drag + save");
  const saved = JSON.parse(second);
  assert.deepEqual(validateClip(saved, "walk-lab"), []);
  assert.ok(saved.tracks["armN.elbow"]?.keys.some((k: Any) => Math.abs(k.u - 0.25) < 0.03), "elbow keyed near u 0.25: " + JSON.stringify(saved.tracks["armN.elbow"]));
  assert.equal(saved.builtin, undefined);
  // reload: the clip comes back from disk with the new key
  await page.reload();
  await page.waitForSelector("body[data-ready='1']", { timeout: 30_000 });
  await page.click("#tab-rig");
  await page.click('#rig-clip-list li[data-clip="walk-lab"]');
  const elbowAfter = await page.evaluate(() => (window as Any).__labRig.channels("walk-lab", 0.25 / 1.15));
  const key = saved.tracks["armN.elbow"].keys.find((k: Any) => Math.abs(k.u - 0.25) < 0.03);
  assert.ok(Math.abs(elbowAfter["armN.elbow"] - key.v) < 1e-6, `reloaded elbow ${elbowAfter["armN.elbow"]} = saved key ${key.v}`);
  // exports: contact sheet and baked atlas saved under art-sources/lab/exports/
  await page.click("#rig-export");
  await page.click(".modal-form button[type=submit]");
  await page.waitForSelector("#rig-export-box");
  await page.screenshot({ path: `${SHOTS}/rig-contact.png` });
  await page.click("#rig-export-save");
  await page.waitForFunction(() => /Saved art-sources\/lab\/exports/.test(document.getElementById("toasts")?.textContent || ""), null, { timeout: 15_000 });
  await page.click("#rig-export-close");
  await page.click("#rig-bake");
  await page.waitForSelector("#rig-bake-preview");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/rig-bake.png` });
  await page.click("#rig-export-save");
  await page.click("#rig-export-close");
  for (const f of ["walk-lab-contact.png", "walk-lab-atlas.png"]) {
    let size = 0;
    for (let i = 0; i < 50 && !size; i++) { size = (await stat(path.join(root, "art-sources/lab/exports", f)).catch(() => null))?.size || 0; if (!size) await page.waitForTimeout(100); }
    assert.ok(size > 100, `${f} saved under art-sources/lab/exports/`);
  }
  await page.click("#rig-onion");
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/rig-onion.png` });

  assert.deepEqual(errors, [], "console errors:\n" + errors.join("\n"));
  await page.close();
});
