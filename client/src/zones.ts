// Modular building phase 3 (shared/src/zones.ts): the client side of zones. Ground art for growing-zone crops and
// loose goods (always shown), translucent zone overlays (strong while a Zones tool is in hand), and the zone list
// panel (rename, crop, stockpile filters, delete, which zone a paint drag extends). All art is procedural stand-ins
// (SPRITES.md #92 / #93).
import { Container, Graphics } from "pixi.js";
import type { ClientMessage } from "@colony/shared/protocol";
import { iconImg, stockIconUrl } from "./spriteRegistry";
import {
  CROP_LABEL, CROPS, CropStage, PILE_RESOURCES, STOCK_CATEGORIES, STOCK_CATEGORY_LABEL, ZONE_KIND_COLOR, ZONE_KIND_LABEL, rleDecode,
  type CropId, type StockCategory, type ZoneSnapshot, type ZonesSnapshot,
} from "@colony/shared/zones";

export interface ZonesUi {
  // Under buildings / units (crops, piles); over it the overlay.
  ground: Container;
  overlay: Graphics;
  apply(z: ZonesSnapshot | undefined): void;
  setActive(on: boolean): void;
  selected(): ZoneSnapshot | null;
  reset(): void;
  // Stardew phase 5a: the crop tile at index i (zone tile or hero plot), for the hotbar hints.
  cropAt(i: number): { stage: number; watered: boolean } | null;
}

const PILE_COLOR: Record<string, number> = {
  grain: 0xe8c860, meat: 0xc05050, fruit: 0xd06090, wood: 0x8a5a2b, rock: 0x9a9ca1, iron: 0x6a6a78, wool: 0xf0f0e8,
  cotton: 0xd8e0c0, clothes: 0x6080c0, tools: 0x707070, luxuryItems: 0xc0a0e0, gold: 0xf0d040, alcohol: 0xa06030,
};

export function setupZones(opts: { tileSize: () => number; worldTilesX: () => number; send: (m: ClientMessage) => void }): ZonesUi {
  const ground = new Container();
  const cropG = new Graphics();
  const pileG = new Graphics();
  ground.addChild(cropG, pileG);
  const overlay = new Graphics();
  let latest: ZonesSnapshot = { zones: [], crops: [], piles: [] };
  const cropCodes = new Map<number, number>();
  let active = false;
  let selectedId: number | null = null;
  let knownIds = new Set<number>();
  let sig = "";

  // ---- panel ----
  const panel = document.createElement("div");
  panel.id = "zone-panel";
  panel.style.cssText =
    "position: fixed; right: 12px; top: 120px; width: 270px; max-height: 60vh; overflow-y: auto; background: rgba(20,22,28,0.92);" +
    "color: #e8e8e8; border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; padding: 8px; font: 12px sans-serif; z-index: 30; display: none;";
  document.body.appendChild(panel);

  function renderPanel() {
    const head = document.createElement("div");
    head.style.cssText = "font-weight: bold; margin-bottom: 4px;";
    head.textContent = "Zones";
    const help = document.createElement("div");
    help.style.cssText = "opacity: 0.75; margin-bottom: 6px;";
    help.textContent = "Right-drag paints (extends the selected zone of that kind, else a new zone). Shift + right-drag or the Erase tool erases.";
    const rows: HTMLElement[] = [];
    for (const z of latest.zones) {
      const row = document.createElement("div");
      row.style.cssText = `border-left: 4px solid #${ZONE_KIND_COLOR[z.kind].toString(16).padStart(6, "0")}; padding: 4px 6px; margin: 4px 0; background: ${z.id === selectedId ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)"}; cursor: pointer;`;
      row.title = "Click to select (paint drags extend it)";
      row.addEventListener("click", () => {
        selectedId = z.id === selectedId ? null : z.id;
        renderPanel();
        draw();
      });
      const top = document.createElement("div");
      top.style.cssText = "display: flex; gap: 6px; align-items: center;";
      const name = document.createElement("span");
      name.style.cssText = "flex: 1; font-weight: bold;";
      name.textContent = `${z.name}`;
      const size = document.createElement("span");
      size.style.opacity = "0.7";
      size.textContent = `${ZONE_KIND_LABEL[z.kind]}, ${rleDecode(z.tiles).length} tiles`;
      const btn = (label: string, title: string, fn: () => void) => {
        const b = document.createElement("button");
        b.className = "econ-btn";
        b.style.cssText = "padding: 0 4px; font-size: 11px;";
        b.textContent = label;
        b.title = title;
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          b.blur();
          fn();
        });
        return b;
      };
      top.append(
        name,
        btn("Rename", "Rename this zone", () => {
          const n = window.prompt("Zone name", z.name);
          if (n && n.trim()) opts.send({ type: "zoneEdit", op: "rename", zoneId: z.id, name: n.trim() });
        }),
        btn("Delete", "Remove the whole zone", () => opts.send({ type: "zoneEdit", op: "delete", zoneId: z.id }))
      );
      row.append(top, size);
      if (z.kind === "growing") {
        const sel = document.createElement("select");
        for (const c of CROPS) {
          const o = document.createElement("option");
          o.value = c;
          o.textContent = CROP_LABEL[c];
          o.selected = z.crop === c;
          sel.append(o);
        }
        sel.title = "Changing the crop resets sown tiles to tilled soil";
        sel.addEventListener("click", (e) => e.stopPropagation());
        sel.addEventListener("change", () => opts.send({ type: "zoneEdit", op: "setCrop", zoneId: z.id, crop: sel.value as CropId }));
        row.append(sel);
      }
      if (z.kind === "stockpile") {
        const box = document.createElement("div");
        box.style.cssText = "display: flex; flex-wrap: wrap; gap: 2px 8px; margin-top: 3px;";
        const filters = new Set(z.filters ?? []);
        const all = STOCK_CATEGORIES.every((c) => filters.has(c));
        const mk = (label: string, checked: boolean, onChange: (on: boolean) => void, icon?: string) => {
          const l = document.createElement("label");
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = checked;
          cb.addEventListener("click", (e) => e.stopPropagation());
          cb.addEventListener("change", () => onChange(cb.checked));
          l.addEventListener("click", (e) => e.stopPropagation());
          l.append(cb, ...(icon ? [iconImg(icon, 14), " "] : []), label);
          return l;
        };
        box.append(mk("Everything", all, (on) => opts.send({ type: "zoneEdit", op: "setFilters", zoneId: z.id, filters: on ? [...STOCK_CATEGORIES] : [] })));
        for (const c of STOCK_CATEGORIES) {
          box.append(mk(STOCK_CATEGORY_LABEL[c], filters.has(c), (on) => {
            const next = new Set(filters);
            if (on) next.add(c);
            else next.delete(c);
            opts.send({ type: "zoneEdit", op: "setFilters", zoneId: z.id, filters: [...next] as StockCategory[] });
          }, stockIconUrl(c)));
        }
        const stored = Object.entries(z.stored ?? {}).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(", ");
        const st = document.createElement("div");
        st.style.cssText = "opacity: 0.8; margin-top: 2px;";
        st.textContent = `Stored: ${stored || "nothing yet"}`;
        st.title = "Goods haulers brought here that are still in the stock (the stock counts include them)";
        row.append(box, st);
      }
      if (z.kind === "animal") {
        const n = document.createElement("div");
        n.style.opacity = "0.7";
        n.textContent = "Placeholder: animals use it from a later phase";
        row.append(n);
      }
      rows.push(row);
    }
    const loose = new Map<string, number>();
    for (let k = 0; k + 2 < latest.piles.length; k += 3) {
      const res = PILE_RESOURCES[latest.piles[k + 1]] ?? "?";
      loose.set(res, (loose.get(res) ?? 0) + latest.piles[k + 2]);
    }
    const looseEl = document.createElement("div");
    looseEl.style.cssText = "opacity: 0.8; margin-top: 6px;";
    looseEl.textContent = `Loose goods waiting for haulers: ${[...loose].map(([k, n]) => `${n} ${k}`).join(", ") || "none"}`;
    if (latest.zones.length === 0) {
      const none = document.createElement("div");
      none.style.opacity = "0.7";
      none.textContent = "No zones yet. Pick a zone tool and right-drag on open ground.";
      rows.push(none);
    }
    panel.replaceChildren(head, help, ...rows, looseEl);
  }

  // ---- drawing ----
  function draw() {
    const ts = opts.tileSize();
    const W = opts.worldTilesX();
    cropG.clear();
    pileG.clear();
    overlay.clear();
    const cropOf = new Map<number, CropId>();
    const zoneOf = new Map<number, number>();
    for (const z of latest.zones) {
      const tiles = rleDecode(z.tiles);
      for (const i of tiles) {
        zoneOf.set(i, z.id);
        if (z.crop) cropOf.set(i, z.crop);
      }
    }
    // Crops (stand-ins: tilled soil, seeds, sprouts, ripe heads). Code: stage (bits 0-2), tended / watered (bit 3,
    // darker soil), a hero plot's own crop index + 1 (bits 4+).
    cropCodes.clear();
    for (let k = 0; k + 1 < latest.crops.length; k += 2) {
      const i = latest.crops[k];
      const code = latest.crops[k + 1];
      cropCodes.set(i, code);
      const stage = code & 7;
      const watered = (code & 8) !== 0;
      const own = code >> 4 ? CROPS[(code >> 4) - 1] : undefined;
      const x = (i % W) * ts;
      const y = Math.floor(i / W) * ts;
      cropG.rect(x + 1, y + 1, ts - 2, ts - 2).fill({ color: watered ? 0x4a3220 : 0x6b4a2a, alpha: 0.9 });
      for (let r = 0; r < 4; r++) cropG.rect(x + 3, y + 5 + r * 7, ts - 6, 2).fill({ color: watered ? 0x2e1e10 : 0x4a3018, alpha: 0.9 });
      const hemp = (own ?? cropOf.get(i)) === "hemp";
      if (stage === CropStage.Sown) {
        for (let r = 0; r < 4; r++) for (let q = 0; q < 4; q++) cropG.rect(x + 5 + q * 7, y + 4 + r * 7, 2, 2).fill(0xd8c890);
      } else if (stage === CropStage.Growing) {
        for (let r = 0; r < 4; r++) for (let q = 0; q < 4; q++) cropG.rect(x + 4 + q * 7, y + 2 + r * 7, 3, 5).fill(hemp ? 0x5aa060 : 0x7ac050);
      } else if (stage === CropStage.Ripe) {
        for (let r = 0; r < 4; r++) for (let q = 0; q < 4; q++) cropG.rect(x + 3 + q * 7, y + 1 + r * 7, 5, 7).fill(hemp ? 0x3f8a6a : 0xe0c050);
      }
    }
    // Loose goods: a sack per tile in its good's colour.
    for (let k = 0; k + 2 < latest.piles.length; k += 3) {
      const i = latest.piles[k];
      const res = PILE_RESOURCES[latest.piles[k + 1]] ?? "grain";
      const x = (i % W) * ts;
      const y = Math.floor(i / W) * ts;
      pileG.roundRect(x + ts * 0.3, y + ts * 0.35, ts * 0.4, ts * 0.45, 4).fill(PILE_COLOR[res] ?? 0xffffff).stroke({ width: 1, color: 0x2a2010 });
    }
    // Overlay: a translucent fill per tile + an outline where the zone ends; the selected zone brighter.
    const fillA = active ? 0.22 : 0.07;
    const edgeA = active ? 0.85 : 0.3;
    for (const z of latest.zones) {
      const color = ZONE_KIND_COLOR[z.kind];
      const sel = z.id === selectedId && active;
      for (const i of rleDecode(z.tiles)) {
        const tx = i % W;
        const ty = Math.floor(i / W);
        overlay.rect(tx * ts, ty * ts, ts, ts).fill({ color, alpha: sel ? fillA + 0.12 : fillA });
        const edge = (j: number, ok: boolean, x0: number, y0: number, w: number, h: number) => {
          if (ok && zoneOf.get(j) === z.id) return;
          overlay.rect(x0, y0, w, h).fill({ color, alpha: edgeA });
        };
        edge(i - W, ty > 0, tx * ts, ty * ts, ts, 2);
        edge(i + W, true, tx * ts, (ty + 1) * ts - 2, ts, 2);
        edge(i - 1, tx > 0, tx * ts, ty * ts, 2, ts);
        edge(i + 1, tx < W - 1, (tx + 1) * ts - 2, ty * ts, 2, ts);
      }
    }
  }

  return {
    ground,
    overlay,
    apply(z) {
      if (!z) return;
      const next = JSON.stringify(z);
      if (next === sig) return;
      sig = next;
      latest = z;
      // A zone that just appeared (a new paint drag) becomes the selected one.
      const ids = new Set(z.zones.map((q) => q.id));
      const fresh = z.zones.filter((q) => !knownIds.has(q.id));
      if (knownIds.size > 0 || fresh.length === 1) for (const q of fresh) selectedId = q.id;
      if (selectedId !== null && !ids.has(selectedId)) selectedId = null;
      knownIds = ids;
      draw();
      if (active) renderPanel();
    },
    setActive(on) {
      if (on === active) return;
      active = on;
      panel.style.display = on ? "block" : "none";
      if (on) renderPanel();
      draw();
    },
    selected() {
      return latest.zones.find((q) => q.id === selectedId) ?? null;
    },
    cropAt(i) {
      const code = cropCodes.get(i);
      return code === undefined ? null : { stage: code & 7, watered: (code & 8) !== 0 };
    },
    reset() {
      latest = { zones: [], crops: [], piles: [] };
      sig = "";
      knownIds = new Set();
      selectedId = null;
      draw();
      if (active) renderPanel();
    },
  };
}
