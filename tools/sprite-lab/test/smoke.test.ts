// ONE headless-browser smoke test of the whole Lab on a scratch copy (LAB_ROOT): every tab opens with zero console errors,
// a pivot edit survives save + reload, and a part edited through the Piskel iframe is sent back and changes the PNG on disk.
// Screenshots go to $LAB_SHOTS (default: the session scratchpad), never into the repo.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { startLab, type Lab } from "../server/lab.ts";
import { scratchRoot } from "./helpers.ts";

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

  assert.deepEqual(errors, [], "console errors:\n" + errors.join("\n"));
  await page.close();
});
