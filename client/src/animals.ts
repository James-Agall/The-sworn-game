// animals.ts (client): Stardew phase 5d livestock (shared/src/animals.ts). Draws the animals the server reports
// outdoors (snapshot `livestock.a`: one staged pose each, a small bob and a flip while moving, need icons over hungry /
// thirsty / sick ones), need icons over the clan's animal houses (`livestock.h`), and the animal-house section of the
// building panel (BuildingInfo.animals: animals with bars, feed / water, products, buy / slaughter / rename).
// Gap closure G6: a ridden horse (LF_RIDDEN) is drawn at its rider (stand-in for mounted-hero art, SPRITES.md); the
// panel adds Sell (price) / Ride per animal and "Call them in" / "Let them out".
import { Assets, Container, Sprite, Texture } from "pixi.js";
import {
  HF_FEED_LOW, HF_PRODUCTS, HF_WATER_LOW, HOUSE_STRIDE, LF_BABY, LF_HUNGRY, LF_MALE, LF_MOVING, LF_RIDDEN, LF_SICK, LF_THIRSTY,
  LIVESTOCK_STRIDE, SPECIES, type AnimalHouseInfo, type LivestockSnapshot,
} from "@colony/shared/animals";
import { LIVESTOCK_ART, NEED_ICON, iconImg, iconUrl } from "./spriteRegistry";

// Cosmetic numbers (client only).
const BOB_PX = 1.5;
const BOB_MS = 220;
const NEED_ICON_PX = 10;
const HOUSE_ICON_PX = 14;
// Stand-in tint per species if its art is missing (a white square scaled to the species size).
const STANDIN_TINT: Record<string, number> = { chicken: 0xf4f0e0, cow: 0x8a6a50, pig: 0xf0b0b8, sheep: 0xeeeeee, horse: 0x7a5a3a };

export interface LivestockDeps {
  layer: Container;
  tileSize: () => number;
  worldTilesX: () => number;
  zOf: (x: number, y: number) => number;
}

const tex = new Map<string, Texture>();
async function loadAll() {
  const urls = new Set<string>([...Object.values(NEED_ICON), iconUrl("item_egg")]);
  for (const a of Object.values(LIVESTOCK_ART)) [a.adult, a.male, a.baby].forEach((u) => u && urls.add(u));
  for (const url of urls) {
    try {
      const t = await Assets.load<Texture>(url);
      if (t) tex.set(url, t);
    } catch {
      // Missing: the stand-in is used.
    }
  }
}

export function createLivestock(deps: LivestockDeps) {
  void loadAll();
  const sprites = new Map<number, { body: Sprite; icon: Sprite | null; lastX: number; phase: number; key: string }>();
  const houseIcons = new Map<number, Sprite>();

  function textureFor(species: string, flags: number): { t: Texture; size: number; key: string } {
    const art = LIVESTOCK_ART[species];
    const url = flags & LF_BABY ? art.baby : flags & LF_MALE && art.male ? art.male : art.adult;
    const size = art.size * (flags & LF_BABY ? 0.6 : 1);
    const t = tex.get(url);
    return t ? { t, size, key: url } : { t: Texture.WHITE, size, key: "standin" };
  }
  function iconFor(flags: number): string | null {
    if (flags & LF_SICK) return NEED_ICON.sick;
    if (flags & LF_HUNGRY) return NEED_ICON.hungry;
    if (flags & LF_THIRSTY) return NEED_ICON.thirst;
    return null;
  }

  function sync(snap: LivestockSnapshot | undefined) {
    const now = performance.now();
    const ts = deps.tileSize();
    const seen = new Set<number>();
    const a = snap?.a ?? [];
    for (let i = 0; i + LIVESTOCK_STRIDE <= a.length; i += LIVESTOCK_STRIDE) {
      const id = a[i];
      const species = SPECIES[a[i + 1]] ?? "chicken";
      const x = a[i + 2];
      const y = a[i + 3];
      const flags = a[i + 4];
      seen.add(id);
      const { t, size, key } = textureFor(species, flags);
      let e = sprites.get(id);
      if (!e || e.key !== key) {
        e?.body.destroy();
        e?.icon?.destroy();
        const body = new Sprite(t);
        body.anchor.set(0.5, 1);
        if (key === "standin") body.tint = STANDIN_TINT[species] ?? 0xffffff;
        deps.layer.addChild(body);
        e = { body, icon: null, lastX: x, phase: Math.random() * 1000, key };
        sprites.set(id, e);
      }
      const scale = key === "standin" ? size / 16 : size / Math.max(t.width, t.height);
      const moving = (flags & LF_MOVING) !== 0;
      const bob = moving ? Math.abs(Math.sin((now + e.phase) / BOB_MS)) * BOB_PX : 0;
      // A ridden horse stands under its rider's sprite (the rider is drawn above it).
      const ridden = (flags & LF_RIDDEN) !== 0;
      e.body.position.set(x, y + ts * (ridden ? 0.45 : 0.2) - bob);
      if (Math.abs(x - e.lastX) > 0.3) e.body.scale.set(x > e.lastX ? scale : -scale, scale);
      else if (e.body.scale.y !== scale) e.body.scale.set(Math.sign(e.body.scale.x || 1) * scale, scale);
      e.lastX = x;
      const z = deps.zOf(x, y) - (ridden ? 1 : 0);
      if (e.body.zIndex !== z) e.body.zIndex = z;
      const iconUrlNow = iconFor(flags);
      const it = iconUrlNow ? tex.get(iconUrlNow) : undefined;
      if (it) {
        if (!e.icon) {
          e.icon = new Sprite(it);
          e.icon.anchor.set(0.5, 1);
          deps.layer.addChild(e.icon);
        }
        e.icon.texture = it;
        e.icon.scale.set(NEED_ICON_PX / it.width);
        e.icon.position.set(x, y + ts * 0.2 - size * 0.9);
        e.icon.zIndex = z + 0.01;
      } else if (e.icon) {
        e.icon.destroy();
        e.icon = null;
      }
    }
    for (const [id, e] of sprites) {
      if (seen.has(id)) continue;
      e.body.destroy();
      e.icon?.destroy();
      sprites.delete(id);
    }
    // House need icons: feed low > water low > products waiting.
    const seenH = new Set<number>();
    const h = snap?.h ?? [];
    const W = deps.worldTilesX();
    for (let i = 0; i + HOUSE_STRIDE <= h.length; i += HOUSE_STRIDE) {
      const index = h[i];
      const f = h[i + 1];
      const url = f & HF_FEED_LOW ? NEED_ICON.hungry : f & HF_WATER_LOW ? NEED_ICON.thirst : f & HF_PRODUCTS ? iconUrl("item_egg") : null;
      const t = url ? tex.get(url) : undefined;
      if (!t) continue;
      seenH.add(index);
      let s = houseIcons.get(index);
      if (!s) {
        s = new Sprite(t);
        s.anchor.set(0.5, 1);
        deps.layer.addChild(s);
        houseIcons.set(index, s);
      }
      s.texture = t;
      s.scale.set(HOUSE_ICON_PX / t.width);
      const px = ((index % W) + 0.5) * ts;
      const py = Math.floor(index / W) * ts - 2 - Math.abs(Math.sin(now / 400)) * 2;
      s.position.set(px, py);
      s.zIndex = deps.zOf(px, py + ts) + 0.5;
    }
    for (const [index, s] of houseIcons) {
      if (seenH.has(index)) continue;
      s.destroy();
      houseIcons.delete(index);
    }
  }
  function clear() {
    sync(undefined);
  }
  return { sync, clear };
}

// ---- the building panel section ----
export interface AnimalPanelDeps {
  anchor: HTMLElement;
  send: (msg: Record<string, unknown>) => void;
  tile: () => { tx: number; ty: number } | null;
  refresh: () => void;
}
function bar(value: number, color: string, title: string): HTMLElement {
  const outer = document.createElement("span");
  outer.title = `${title} ${value}%`;
  outer.style.cssText = "display:inline-block;width:34px;height:6px;background:rgba(0,0,0,.18);border-radius:3px;margin:0 3px;vertical-align:middle;overflow:hidden";
  const inner = document.createElement("span");
  inner.style.cssText = `display:block;height:100%;width:${Math.max(0, Math.min(100, value))}%;background:${color}`;
  outer.append(inner);
  return outer;
}
export function createAnimalPanel(deps: AnimalPanelDeps) {
  const row = document.createElement("div");
  row.id = "bp-animals-row";
  row.hidden = true;
  row.style.cssText = "margin-top:8px;font-size:12.5px";
  deps.anchor.after(row);
  let shownKey = "";
  const act = (m: Record<string, unknown>) => {
    const t = deps.tile();
    if (!t) return;
    deps.send({ type: "animalAction", tileX: t.tx, tileY: t.ty, ...m });
    window.setTimeout(deps.refresh, 150);
  };
  function render(info: AnimalHouseInfo | undefined) {
    row.hidden = !info;
    if (!info) {
      shownKey = "";
      return;
    }
    const key = JSON.stringify(info);
    if (key === shownKey) return;
    shownKey = key;
    const head = document.createElement("div");
    head.style.cssText = "font-weight:600;margin-bottom:4px";
    head.textContent = `Animals ${info.animals.length}/${info.capacity}${info.winter ? " · winter: indoors" : info.grazing ? " · grazing" : ""}`;
    const status = document.createElement("div");
    status.append(
      iconImg(NEED_ICON.hungry, 14, "Feeder"), ` Feed ${info.feed}/${info.feedCap} `,
      iconImg(NEED_ICON.thirst, 14, "Trough"), ` Water ${info.autoWater ? "auto (water nearby)" : `${info.water}/${info.waterCap}`}`,
    );
    const prod = document.createElement("div");
    prod.textContent = `Today: ${info.today} · Waiting: ${info.waiting} · ${info.keeper}`;
    const list = document.createElement("div");
    list.style.cssText = "max-height:180px;overflow-y:auto;margin:4px 0";
    for (const a of info.animals) {
      const line = document.createElement("div");
      line.style.cssText = "display:flex;align-items:center;gap:4px;flex-wrap:wrap;padding:1px 0";
      const name = document.createElement("span");
      name.style.cssText = "min-width:110px";
      name.textContent = `${a.name ? `${a.name} (${a.label})` : a.label}${a.baby ? "" : ""} · ${a.ageDays}d`;
      name.title = a.product;
      line.append(
        name,
        iconImg(NEED_ICON.hungry, 12, "Fed"), bar(a.fed, "#c8913a", "Fed"),
        iconImg(NEED_ICON.thirst, 12, "Watered"), bar(a.watered, "#4a90c8", "Watered"),
        iconImg(NEED_ICON.happy, 12, "Happiness"), bar(a.happiness, "#5aa84a", "Happiness"),
        iconImg(NEED_ICON.sick, 12, "Health"), bar(a.health, "#c84a4a", "Health"),
      );
      const ren = document.createElement("button");
      ren.className = "econ-btn";
      ren.textContent = "Rename";
      ren.addEventListener("click", () => {
        ren.blur();
        const n = window.prompt("Name this animal (empty clears):", a.name);
        if (n !== null) act({ op: "rename", id: a.id, name: n });
      });
      const sl = document.createElement("button");
      sl.className = "econ-btn";
      sl.textContent = "Slaughter";
      sl.disabled = a.baby;
      sl.title = a.baby ? "Only fully grown animals" : "Meat (and hide) into the stores";
      sl.addEventListener("click", () => {
        sl.blur();
        if (window.confirm(`Slaughter ${a.name || `the ${a.label.toLowerCase()}`}?`)) act({ op: "slaughter", id: a.id });
      });
      const sell = document.createElement("button");
      sell.className = "econ-btn";
      sell.textContent = `Sell (${a.price})`;
      sell.disabled = !info.sellVenue || a.ridden;
      sell.title = a.ridden ? "Being ridden" : info.sellVenue ? `Sell to ${info.sellVenue} for ${a.price} gold` : info.sellWhy;
      sell.addEventListener("click", () => {
        sell.blur();
        if (window.confirm(`Sell ${a.name || `the ${a.label.toLowerCase()}`} for ${a.price} gold?`)) act({ op: "sell", id: a.id });
      });
      line.append(ren, sl, sell);
      if (a.species === "horse") {
        const ride = document.createElement("button");
        ride.className = "econ-btn";
        ride.textContent = a.ridden ? "Ridden" : "Ride";
        ride.disabled = a.ride !== "";
        ride.title = a.ride || "Mount this horse (X dismounts)";
        ride.addEventListener("click", () => {
          ride.blur();
          act({ op: "ride", id: a.id });
        });
        line.append(ride);
      }
      list.append(line);
    }
    if (info.animals.length === 0) list.textContent = "No animals yet: buy some below.";
    const buy = document.createElement("div");
    buy.style.cssText = "display:flex;flex-wrap:wrap;gap:4px";
    for (const b of info.buy) {
      const btn = document.createElement("button");
      btn.className = "econ-btn";
      btn.textContent = `Buy ${b.label} (${b.gold} gold)`;
      btn.disabled = !b.ok;
      btn.title = b.reason;
      btn.addEventListener("click", () => {
        btn.blur();
        act({ op: "buy", species: b.species, male: b.male });
      });
      buy.append(btn);
    }
    const notes = document.createElement("ul");
    notes.style.cssText = "margin:4px 0 0 16px;padding:0;color:var(--ink-soft)";
    for (const n of info.notes) {
      const li = document.createElement("li");
      li.textContent = n;
      notes.append(li);
    }
    const herd = document.createElement("div");
    herd.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:4px";
    const call = document.createElement("button");
    call.className = "econ-btn";
    call.textContent = info.penned ? "Let them out" : "Call them in";
    call.title = info.penned ? "The animals may graze again" : "The animals walk back inside and stay in until you let them out (or dawn)";
    call.addEventListener("click", () => {
      call.blur();
      act({ op: "herd", on: !info.penned });
    });
    herd.append(call, ` ${info.outdoors} outdoors · ${info.sellVenue ? `selling to ${info.sellVenue}` : info.sellWhy}`);
    row.replaceChildren(head, status, prod, list, buy, herd, notes);
  }
  return { render };
}
