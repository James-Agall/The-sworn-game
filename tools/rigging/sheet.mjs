#!/usr/bin/env node
// Render a contact sheet from a rig page without a human: node sheet.mjs <page.html> <spec.json | inline json> <out.png>
//
// The page must expose  window.__rig.sheet(spec) -> dataURL (PNG)  (see templates in SKILL.md; it builds frames with
// Rig.sheet). Spec shape, interpreted by the page:
//   { "cols": 4, "scale": 2, "frames": [ { "label": "contact", "cfg": { "weapon": "sword", "state": "attack" }, "t": 0.12 } ] }
// A frame's `cfg` is merged over the page's default config, `t` is the animation clock in seconds (frozen).
//
// Playwright is not a dependency of the skill: set PLAYWRIGHT to a playwright-core entry (index.mjs) or put playwright-core
// in a parent node_modules. Default tries the copy found on this machine.
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CANDIDATES = [process.env.PLAYWRIGHT, "/home/james/projects/auto-loan/node_modules/playwright-core/index.mjs", "playwright-core"].filter(Boolean);
let chromium;
for (const c of CANDIDATES) { try { ({ chromium } = await import(c.startsWith("/") ? pathToFileURL(c).href : c)); break; } catch { /* next */ } }
if (!chromium) { console.error("playwright-core not found: set PLAYWRIGHT=/path/to/playwright-core/index.mjs"); process.exit(2); }

const [page, specArg, out] = process.argv.slice(2);
if (!page || !specArg || !out) { console.error("usage: node sheet.mjs <page.html> <spec.json|inline-json> <out.png>"); process.exit(2); }
const spec = JSON.parse(existsSync(specArg) ? readFileSync(specArg, "utf8") : specArg);
const url = /^(https?|file):/.test(page) ? page : pathToFileURL(resolve(page)).href;

// --allow-file-access-from-files: a file:// page may then read sprite PNGs without tainting the canvas (toDataURL works)
const browser = await chromium.launch({ args: ["--allow-file-access-from-files"] });
const p = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await p.goto(url);
await p.waitForFunction(() => window.__rig && typeof window.__rig.sheet === "function", null, { timeout: 15000 });
const data = await p.evaluate((s) => window.__rig.sheet(s), spec);
writeFileSync(out, Buffer.from(data.split(",")[1], "base64"));
console.log(`wrote ${out}${errors.length ? "\npage errors: " + JSON.stringify(errors) : ""}`);
await browser.close();
