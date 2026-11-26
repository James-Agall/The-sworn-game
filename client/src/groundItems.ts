// groundItems.ts (client): Inventory 2026-11-26 (INVENTORY-2026-11-26.md; server/src/groundItems.ts). Draws the stacks
// dropped on the ground near the hero (snapshot `ground`, sent only when it changes): a goods icon or a gear icon on a
// small shadow, static (nothing per frame). The nearest stack within reach gets a "E  Pick up ..." prompt (E picks up
// through the server's interact priority: talking first); hovering a stack shows "Click: pick up ..." and a click
// sends pickupGround.
import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import type { GroundItemSnapshot } from "@colony/shared/protocol";
import { PACK_LABEL } from "@colony/shared/herolife";
import { loadTexture } from "./atlas";
import { gearIconUrl } from "./heroAppearance";

// Same reach as the server (GROUND_REACH_TILES); the click hit radius in world px.
const REACH_TILES = 1.5;
const HIT_PX = 13;
const ICON_PX = 16;
const TIER_COLOR: Record<string, number> = { "1": 0xcd7f32, "2": 0xc0c8d0, "3": 0xf2c94c, relic: 0x1aa39a };

export interface GroundItemsUi {
  layer: Container;
  // The prompt label: added to the world over buildings and units.
  overlay: Container;
  sync: (list: GroundItemSnapshot[] | undefined) => void;
  // The hero's position (world px), after each snapshot: updates the E prompt.
  near: (x: number, y: number) => void;
  hover: (x: number, y: number) => void;
  // The stack under a click (world px), if any.
  hit: (x: number, y: number) => GroundItemSnapshot | null;
  clear: () => void;
}

// Stacks lie on their tile's centre (server): several on one tile are fanned out around it (in id order) so they
// don't hide each other; the k-th of a tile goes to FAN[k % FAN.length].
const FAN = [[0, 4], [-9, -2], [9, -2], [-9, 9], [9, 9], [0, -8], [0, 13]];

export const groundItemName = (s: GroundItemSnapshot) => (s.k === "e" ? s.name ?? "an item" : `${s.qty} ${PACK_LABEL[s.good!]?.toLowerCase() ?? s.good}`);

export function createGroundItems(tileSize: () => number): GroundItemsUi {
  const layer = new Container();
  const overlay = new Container();
  const items = new Map<string, { node: Container; snap: GroundItemSnapshot; key: string }>();
  const textures = new Map<string, Texture | null>();
  const label = new Text({
    text: "",
    style: { fontFamily: "Palatino Linotype, Palatino, Georgia, serif", fontSize: 8, fontWeight: "bold", fill: 0xfff2d1, stroke: { color: 0x000000, width: 2.5 } },
  });
  label.anchor.set(0.5, 1);
  label.visible = false;
  overlay.addChild(label);
  let nearId: string | null = null;
  let hoverId: string | null = null;

  const urlOf = (s: GroundItemSnapshot) =>
    s.k === "g" ? `/sprites/icon-${s.good}.png` : gearIconUrl({ slot: s.slot ?? "", kind: s.kind, tier: s.tier ?? 1 }) ?? (s.icon ? `/sprites/${s.icon}.png` : undefined);

  function applyTexture(sprite: Sprite, url: string | undefined) {
    if (!url) return;
    const t = textures.get(url);
    if (t) {
      sprite.texture = t;
      sprite.scale.set(ICON_PX / Math.max(t.width, t.height));
      sprite.visible = true;
      return;
    }
    if (t === null) return;
    loadTexture(url).then(
      (tex) => {
        textures.set(url, tex);
        if (!sprite.destroyed) applyTexture(sprite, url);
      },
      () => textures.set(url, null),
    );
  }

  function build(s: GroundItemSnapshot): Container {
    const node = new Container();
    const g = new Graphics();
    g.ellipse(0, 7, 9, 3.5).fill({ color: 0x000000, alpha: 0.3 });
    if (s.k === "e") {
      // A small tier-coloured tile behind the gear icon (the placeholder when the icon is missing).
      g.roundRect(-8, -8, 16, 16, 3).fill({ color: 0x3a2a1a, alpha: 0.85 }).stroke({ color: TIER_COLOR[String(s.tier)] ?? 0xcd7f32, width: 2 });
    } else {
      // A burlap stand-in under the goods icon.
      g.roundRect(-7, -6, 14, 12, 4).fill({ color: 0x8a6a40, alpha: 0.9 }).stroke({ color: 0x4a2f18, width: 1 });
    }
    node.addChild(g);
    const sprite = new Sprite(Texture.EMPTY);
    sprite.anchor.set(0.5);
    sprite.visible = false;
    node.addChild(sprite);
    applyTexture(sprite, urlOf(s));
    if (s.k === "g" && (s.qty ?? 0) > 1) {
      const n = new Text({ text: String(s.qty), style: { fontFamily: "Georgia, serif", fontSize: 8, fontWeight: "bold", fill: 0xffffff, stroke: { color: 0x000000, width: 2 } } });
      n.anchor.set(0, 0);
      n.position.set(3, 1);
      node.addChild(n);
    }
    node.position.set(s.x, s.y);
    return node;
  }

  function showLabel() {
    const id = hoverId ?? nearId;
    const it = id ? items.get(id) : undefined;
    if (!it) {
      label.visible = false;
      return;
    }
    const text = `${id === nearId ? "E" : "Click"}: pick up ${groundItemName(it.snap)}`;
    if (label.text !== text) label.text = text;
    label.position.set(it.node.x, it.node.y - 11);
    label.visible = true;
  }

  return {
    layer,
    overlay,
    sync(list) {
      if (!list) return;
      const seen = new Set<string>();
      for (const s of list) {
        seen.add(s.id);
        const key = JSON.stringify(s);
        const had = items.get(s.id);
        if (had?.key === key) continue;
        had?.node.destroy({ children: true });
        const node = build(s);
        layer.addChild(node);
        items.set(s.id, { node, snap: s, key });
      }
      for (const [id, it] of items) {
        if (seen.has(id)) continue;
        it.node.destroy({ children: true });
        items.delete(id);
      }
      const perTile = new Map<string, number>();
      for (const it of [...items.values()].sort((a, b) => a.snap.id.localeCompare(b.snap.id, undefined, { numeric: true }))) {
        const key = `${Math.floor(it.snap.x / tileSize())},${Math.floor(it.snap.y / tileSize())}`;
        const k = perTile.get(key) ?? 0;
        perTile.set(key, k + 1);
        const [dx, dy] = FAN[k % FAN.length];
        it.node.position.set(it.snap.x + dx, it.snap.y + dy);
      }
      if (nearId && !items.has(nearId)) nearId = null;
      if (hoverId && !items.has(hoverId)) hoverId = null;
      showLabel();
    },
    near(x, y) {
      let best: string | null = null;
      let bestD = REACH_TILES * tileSize();
      for (const [id, it] of items) {
        const d = Math.hypot(it.snap.x - x, it.snap.y - y);
        if (d <= bestD) {
          best = id;
          bestD = d;
        }
      }
      if (best !== nearId) {
        nearId = best;
        showLabel();
      }
    },
    hover(x, y) {
      const h = this.hit(x, y)?.id ?? null;
      if (h !== hoverId) {
        hoverId = h;
        showLabel();
      }
    },
    hit(x, y) {
      let best: GroundItemSnapshot | null = null;
      let bestD = HIT_PX;
      for (const it of items.values()) {
        const d = Math.hypot(it.node.x - x, it.node.y - y);
        if (d <= bestD) {
          best = it.snap;
          bestD = d;
        }
      }
      return best;
    },
    clear() {
      for (const it of items.values()) it.node.destroy({ children: true });
      items.clear();
      nearId = hoverId = null;
      label.visible = false;
    },
  };
}
