import { Texture } from "pixi.js";
import { HERO_LOOKS, HORSE_COATS, DEFAULT_HERO_APPEARANCE, heroVisualFromEquipment, type HeroAppearance, type HeroProfileSnapshot, type HeroVisual } from "@colony/shared/protocol";

export const LOOK_LABELS = ["Wanderer", "Ranger", "Vanguard", "Mystic", "Wayfarer", "Herbalist"];
const origins = ["heroes/base", "heroes/marksman", "heroes/champion", "heroes/mage", "workers-c/forager", "specialists-npcs/healer"];
const images = new Map<string, HTMLImageElement>();
const cache = new Map<string, { canvas: HTMLCanvasElement; texture: Texture }>();
const path = (row: string, frame: number) => `/sprites/autumn/frames/${row}-${String(frame + 1).padStart(2, "0")}.png`;
const rows = [...origins, "infantry-v2/militia", "infantry-v2/archer", "infantry-v2/spearman", "heavy-soldiers-v4/heavy-clubman", ...[1,2,3].flatMap(t => [`heavy-soldiers-v4/knight-t${t}`, `spear-pike-tiers/spear-t${t}`]), "animal-walks-c/horse"];
export async function loadHeroAppearanceArt() {
  const jobs = rows.flatMap(row => Array.from({ length: row.includes("animal-walks") ? 4 : 7 }, (_, frame) => path(row, frame)));
  await Promise.all(Array.from({length: 8}, async () => {
    while (jobs.length) {
      const url = jobs.pop()!;
      await new Promise<void>(resolve => { const img = new Image(); img.onload = () => { images.set(url, img); resolve(); }; img.onerror = () => resolve(); img.src = url; });
    }
  }));
}
function canvas(w = 128, h = 128) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
function rowFor(v: HeroVisual) {
  const t = Math.max(1, Math.min(3, v.armour));
  if (v.weapon === "bow") return "infantry-v2/archer";
  if (v.weapon === "staff") return "heroes/mage";
  if (v.weapon === "spear" || v.weapon === "pike") return v.armour ? `spear-pike-tiers/spear-t${t}` : "infantry-v2/spearman";
  if (v.weapon === "club" || v.weapon === "mace") return v.armour ? "heavy-soldiers-v4/heavy-clubman" : "infantry-v2/militia";
  if (v.armour) return `heavy-soldiers-v4/knight-t${t}`;
  if (v.weapon === "sword") return "heroes/champion";
  return origins[HERO_LOOKS.indexOf(v.appearance.look)] ?? origins[0];
}
// These are runtime palette/material variants of the installed art, not new asset downloads.
function coat(c: HTMLCanvasElement, horse: HeroAppearance["horse"]) {
  if (horse === "bay") return;
  const ctx = c.getContext("2d")!, d = ctx.getImageData(0,0,c.width,c.height);
  const rgb = { chestnut: [166,83,44], black: [57,57,63], grey: [184,187,185], palomino: [203,168,103] }[horse];
  for (let i = 0; i < d.data.length; i += 4) {
    if (!d.data[i+3]) continue;
    const l = (d.data[i] * .3 + d.data[i+1] * .59 + d.data[i+2] * .11) / 145;
    if (l < .19) continue; // Keep the outline and eyes.
    for (let k=0;k<3;k++) d.data[i+k] = Math.min(255, rgb[k] * l);
  }
  ctx.putImageData(d,0,0);
}
function drawNormalized(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x=0, y=0, h=128) {
  const scale = Math.min(h / img.height, 128 / img.width);
  const w=img.width*scale, height=img.height*scale;
  ctx.drawImage(img, x + (128-w)/2, y+h-height, w, height);
}
export function heroArt(v: HeroVisual, mounted = false, frame = 0, action = false) {
  const f = action ? 4 + frame % 3 : frame % 4;
  const key = JSON.stringify([v,mounted,f]);
  const prior = cache.get(key); if (prior) return prior;
  const img = images.get(path(rowFor(v),f)); if (!img) return undefined;
  const rider = canvas(), r = rider.getContext("2d")!; r.imageSmoothingEnabled = false; drawNormalized(r,img);
  // Keep bow/staff attack silhouettes; fit the existing tiered torso beneath their arms.
  if (v.armour && ["bow", "staff", "club", "mace"].includes(v.weapon)) {
    const armour = images.get(path(`heavy-soldiers-v4/knight-t${Math.min(3,v.armour)}`,f));
    if (armour) { const a=canvas(), ac=a.getContext("2d")!; ac.imageSmoothingEnabled=false; drawNormalized(ac,armour); r.drawImage(a,43,42,36,43,43,42,36,43); }
  }
  if (v.helmet && !v.armour) {
    const helm = images.get(path("heavy-soldiers-v4/knight-t1",f));
    if (helm) { const a=canvas(), ac=a.getContext("2d")!; drawNormalized(ac,helm); r.drawImage(a,35,4,55,34,35,4,55,34); }
  }
  if (v.shield) { // Existing off-hand equipment, kept clear of the weapon hand.
    r.fillStyle="#292b29"; r.fillRect(33,53,17,29); r.fillStyle=v.armour>=3?"#c8a457":"#9aa5a4"; r.fillRect(35,55,13,24); r.fillStyle="#734535"; r.fillRect(40,57,3,20);
  }
  // Small surcoat accent identifies the selected origin even when a helmet hides the face.
  if (v.armour) { r.fillStyle=["#aa5838","#516849","#82503d","#66566f","#436c70","#a39776"][HERO_LOOKS.indexOf(v.appearance.look)]; r.fillRect(53,77,14,8); }
  let result = rider;
  if (mounted) {
    const horseImg = images.get(path("animal-walks-c/horse",frame%4));
    if (!horseImg) return undefined;
    const horse=canvas(192,128), hc=horse.getContext("2d")!; hc.imageSmoothingEnabled=false; const horseScale=Math.min(192/horseImg.width,128/horseImg.height); hc.drawImage(horseImg,(192-horseImg.width*horseScale)/2,128-horseImg.height*horseScale,horseImg.width*horseScale,horseImg.height*horseScale); coat(horse,v.appearance.horse);
    result=canvas(192,160); const c=result.getContext("2d")!; c.imageSmoothingEnabled=false;
    c.drawImage(horse,8,40,176,120);
    // Saddle, rider and near boot share a fixed seat so gallop frames do not detach the rider.
    c.fillStyle="#513527"; c.fillRect(71,80,43,9); c.fillStyle="#a96a40"; c.fillRect(75,83,32,13);
    // Uniform 0.875 scale (was 0.75 x 0.92: a horizontally squashed rider), seat line kept at y=89.
    c.drawImage(rider,0,0,128,96,33,5,112,84);
    c.drawImage(rider,51,96,25,30,78,83,22,26);
  }
  const texture=Texture.from(result); texture.source.scaleMode="nearest";
  // Bounds texture memory even after repeatedly previewing every combination.
  if(cache.size>384) { const oldest=cache.keys().next().value!; const old=cache.get(oldest)!; cache.delete(oldest); /* Active sprites may still reference old textures; Pixi GC owns them. */ void old; }
  const value={canvas:result,texture}; cache.set(key,value); return value;
}

export function renderAppearancePanel(root: HTMLElement, prof: HeroProfileSnapshot, mounted: boolean, send: (appearance: HeroAppearance) => void, dismount: () => void) {
  root.replaceChildren();
  const a=prof.appearance ?? DEFAULT_HERO_APPEARANCE;
  const head=document.createElement("div"); head.className="appearance-heading"; head.innerHTML='<div><span class="eyebrow">YOUR HERO</span><h3>Character & mount</h3></div>';
  const status=document.createElement("span"); status.className="mount-status"; status.textContent=mounted?"Mounted":"On foot"; head.append(status); root.append(head);
  const previews=document.createElement("div"); previews.className="hero-previews";
  for(const riding of [false,true]) { const art=heroArt(heroVisualFromEquipment(prof.equipment,a),riding); const figure=document.createElement("figure"); if(art){const c=canvas(art.canvas.width,art.canvas.height);c.getContext("2d")!.drawImage(art.canvas,0,0);figure.append(c);} const cap=document.createElement("figcaption"); cap.textContent=riding?"Mounted appearance":"On-foot appearance";figure.append(cap);previews.append(figure); }
  root.append(previews);
  const choices=document.createElement("div"); choices.className="hero-look-grid";
  HERO_LOOKS.forEach((look,i)=>{ const b=document.createElement("button"); b.type="button"; b.className="hero-look"; b.setAttribute("aria-pressed",String(a.look===look)); const img=document.createElement("img"); img.src=path(origins[i],0); img.alt="";b.append(img,document.createTextNode(LOOK_LABELS[i]));b.onclick=()=>send({...a,look});choices.append(b); });root.append(choices);
  const label=document.createElement("label"); label.className="horse-picker"; label.textContent="Horse coat";const select=document.createElement("select");select.setAttribute("aria-label","Horse coat");for(const h of HORSE_COATS){const o=document.createElement("option");o.value=h;o.textContent=h[0].toUpperCase()+h.slice(1);select.append(o);}select.value=a.horse;select.onchange=()=>send({...a,horse:select.value as HeroAppearance["horse"]}); label.append(select);root.append(label);
  const note=document.createElement("p");note.className="appearance-note";note.textContent="Armour and weapons follow your equipped gear. Approach an adult horse and press E to ride. X dismounts. Coat choices are cosmetic.";root.append(note);
  if(mounted){const b=document.createElement("button");b.textContent="Dismount · X";b.onclick=dismount;root.append(b);}
}

export function gearIconUrl(item: { slot: string; kind?: string; tier: number | "relic" }): string | undefined {
  const base="/sprites/autumn/frames/equipment-relic-icons/";
  let row=item.tier === "relic" ? "relic" : `tier${item.tier}`;
  let col: number | undefined;
  if(item.slot === "weapon") {
    if(item.kind === "bow" || item.kind === "staff") { row="relic"; col=item.kind === "bow" ? 7 : 8; }
    else col=item.tier === "relic" ? item.kind === "spear" ? 6 : 5 : item.kind === "spear" ? 9 : item.kind === "club" || item.kind === "mace" ? 8 : 7;
  } else col=({head:1,chest:2,legs:3,offhand:4} as Record<string,number>)[item.slot];
  return col ? `${base}${row}-${String(col).padStart(2,"0")}.png` : undefined;
}
