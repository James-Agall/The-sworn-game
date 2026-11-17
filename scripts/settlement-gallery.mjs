#!/usr/bin/env node
// settlement-gallery.mjs: draw every settlement template (ground + the buildings placed on it + NPC slots) into ONE self-contained
// HTML page, so the layouts can be looked at without starting the game.
//   cd server && node --import tsx ../scripts/settlement-gallery.mjs <out.html> [id-prefix ...]
// The page also exposes window.__rig.sheet() so the rigging skill's sheet.mjs can screenshot it headlessly.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { SETTLEMENT_LEGEND, settlementStats, validateSettlementTemplate, SETTLEMENT_TIER_LABEL } = await import(path.join(ROOT, "shared/src/settlementTemplates.ts"));
const { BUILDING_LEGEND, buildingCells } = await import(path.join(ROOT, "shared/src/buildingTemplates.ts"));

const out = process.argv[2];
const only = process.argv.slice(3);
if (!out) { console.error("usage: settlement-gallery.mjs out.html [id-prefix ...]"); process.exit(2); }

const readDir = (d) => readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(path.join(d, f), "utf8")));
const buildings = new Map(readDir(path.join(ROOT, "server/data/buildings")).map((b) => [b.id, b]));
const lookup = (id) => buildings.get(id);
let settlements = readDir(process.env.SETTLEMENTS_DIR || path.join(ROOT, "server/data/settlements"));
if (only.length) settlements = settlements.filter((s) => only.some((p) => s.id.startsWith(p)));
settlements.sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id));

const data = settlements.map((s) => {
  const errs = validateSettlementTemplate(s, lookup);
  const st = settlementStats(s, lookup);
  const placed = (s.buildings ?? []).map((b) => {
    const bt = lookup(b.ref);
    const { w, h, cells } = buildingCells(bt, b.transform ?? 0);
    return { ref: b.ref, name: bt.name, x: b.x, y: b.y, w, h, cells: cells.map((c) => [c.x, c.y, BUILDING_LEGEND[c.ch]?.color ?? "#888", BUILDING_LEGEND[c.ch]?.kind ?? ""]) };
  });
  return { id: s.id, name: s.name, tier: s.tier, tierLabel: SETTLEMENT_TIER_LABEL[s.tier], w: s.rows[0].length, h: s.rows.length, rows: s.rows, placed, errs, stats: st, garrison: s.garrison, profile: s.profile, note: s.note ?? "" };
});
const legend = Object.fromEntries(Object.entries(SETTLEMENT_LEGEND).map(([k, v]) => [k, { c: v.color, l: v.label, slot: v.slot ?? null }]));

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Settlement templates</title>
<style>:root{--bg:#1d1812;--fg:#f0e2c4;--mut:#b9a784;--card:#2a2219;--line:#4a3b28}
@media (prefers-color-scheme: light){:root{--bg:#f4ecdc;--fg:#2a2118;--mut:#6b5a40;--card:#fffaf0;--line:#d8c9a8}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 Georgia,serif}
header{padding:18px 16px 4px;max-width:1280px;margin:auto}h1{margin:0;font-size:22px}p{color:var(--mut);margin:4px 0}
#grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px;padding:12px 16px 30px;max-width:1280px;margin:auto}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px}.card h2{margin:0;font-size:16px}
.meta{color:var(--mut);font-size:12px;margin:2px 0 8px}canvas{width:100%;image-rendering:pixelated;display:block;border-radius:4px}
.bad{color:#d44;font-size:12px}#key{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;color:var(--mut);padding:0 16px 8px;max-width:1280px;margin:auto}
#key i{display:inline-block;width:10px;height:10px;margin-right:4px;border:1px solid #0006;vertical-align:-1px}</style></head><body>
<header><h1>Settlement templates</h1><p id="sub"></p></header><div id="key"></div><div id="grid"></div>
<script>
"use strict";
const D=${JSON.stringify(data)},L=${JSON.stringify(legend)},Z=11;
document.getElementById("sub").textContent=D.length+" layouts: ground, roads, walls and farms, with each building drawn on top. Letters are people: t trader, r priest, v villager, g guard, q quest giver, K keep (the Elder).";
document.getElementById("key").innerHTML=Object.entries(L).filter(([k])=>k!==".").map(([k,v])=>'<span><i style="background:'+v.c+'"></i>'+k+' '+v.l.split(" (")[0]+'</span>').join("");
function draw(s){
  const c=document.createElement("canvas");c.width=s.w*Z;c.height=s.h*Z;const g=c.getContext("2d");
  g.fillStyle="#7d9a58";g.fillRect(0,0,c.width,c.height);
  for(let y=0;y<s.h;y++)for(let x=0;x<s.w;x++){const ch=s.rows[y][x],e=L[ch];if(!e||ch===".")continue;
    g.fillStyle=e.c;g.fillRect(x*Z,y*Z,Z,Z);
    if(ch==="f"){g.fillStyle="#0002";for(let i=0;i<Z;i+=3)g.fillRect(x*Z,y*Z+i,Z,1)}
    if(e.slot||ch==="K"){g.fillStyle=e.slot?"#fff":"#fff";g.font="bold "+(Z-1)+"px sans-serif";g.textAlign="center";g.textBaseline="middle";g.strokeStyle="#000";g.lineWidth=2;g.strokeText(ch,x*Z+Z/2,y*Z+Z/2+1);g.fillText(ch,x*Z+Z/2,y*Z+Z/2+1)}}
  for(const b of s.placed){for(const [cx,cy,col,kind] of b.cells){g.fillStyle=col;g.fillRect((b.x+cx)*Z,(b.y+cy)*Z,Z,Z);if(kind==="wall"){g.fillStyle="#0003";g.fillRect((b.x+cx)*Z,(b.y+cy)*Z,Z,1)}}
    g.strokeStyle="#000a";g.lineWidth=1;g.strokeRect(b.x*Z+.5,b.y*Z+.5,b.w*Z-1,b.h*Z-1);
    g.font="9px sans-serif";g.textAlign="center";g.textBaseline="middle";g.fillStyle="#fff";g.strokeStyle="#000";g.lineWidth=2.5;
    const t=b.name.length>14?b.name.slice(0,13)+"…":b.name;g.strokeText(t,(b.x+b.w/2)*Z,(b.y+b.h/2)*Z);g.fillText(t,(b.x+b.w/2)*Z,(b.y+b.h/2)*Z)}
  g.strokeStyle="rgba(0,0,0,.08)";g.lineWidth=1;for(let x=0;x<=s.w;x++){g.beginPath();g.moveTo(x*Z+.5,0);g.lineTo(x*Z+.5,c.height);g.stroke()}for(let y=0;y<=s.h;y++){g.beginPath();g.moveTo(0,y*Z+.5);g.lineTo(c.width,y*Z+.5);g.stroke()}
  return c}
const grid=document.getElementById("grid");
for(const s of D){const d=document.createElement("div");d.className="card";const gar=Object.entries(s.garrison||{}).map(([k,v])=>v+" "+k.replace("town","").toLowerCase()).join(", ");
  d.innerHTML='<h2>'+s.name+'</h2><div class="meta">'+s.tierLabel+' · '+s.w+'×'+s.h+' tiles · '+s.placed.length+' buildings · '+s.id+(gar?' · guards: '+gar:'')+'</div>';
  d.appendChild(draw(s));if(s.errs.length){const e=document.createElement("div");e.className="bad";e.textContent="invalid: "+s.errs.join("; ");d.appendChild(e)}
  if(s.note){const n=document.createElement("p");n.textContent=s.note;n.style.fontSize="12px";d.appendChild(n)}grid.appendChild(d)}
window.__rig={sheet(){return new Promise(r=>setTimeout(()=>{r(null)},0))},count:D.length};
</script></body></html>`;
writeFileSync(out, html);
console.log(`wrote ${out}: ${data.length} settlements, ${data.filter((d) => d.errs.length).length} invalid`);
