// settlementEditor.ts: the creative-mode settlement template editor (templateEditor.ts with the ground legend and
// metadata of shared/src/settlementTemplates.ts). Paint roads, plaza, walls, gates, towers, the keep, well, farms,
// props and NPC slots; place BUILDING TEMPLATES by reference (pick one and its transform, "Place building", click the
// grid for its top-left; right-click a building removes it); live stats and validation; Save / Load / Duplicate /
// Delete; "Stamp here" stamps a neutral settlement at the next map click (creativeSet settlement* ops).
import { BUILDING_LEGEND, type BuildingTemplate, buildingCells } from "@colony/shared/buildingTemplates";
import {
  SETTLEMENT_LEGEND, SETTLEMENT_PROFILES, SETTLEMENT_TIER_LABEL, type SettlementTemplate, settlementLayout, settlementStats,
  validateSettlementTemplate,
} from "@colony/shared/settlementTemplates";
import { type EditorDeps, setupTemplateEditor } from "./templateEditor";

function blankRows(n: number): string[] {
  const c = n >> 1;
  return Array.from({ length: n }, (_, y) => {
    let r = "";
    for (let x = 0; x < n; x++) r += x === c && y === c ? "K" : x === c && y > c ? "_" : ".";
    return r;
  });
}

const TRANSFORMS = ["0: as drawn", "1: turned 90°", "2: turned 180°", "3: turned 270°", "4: mirrored", "5: mirrored + 90°", "6: mirrored + 180°", "7: mirrored + 270°"];

export function setupSettlementEditor(deps: EditorDeps) {
  let buildings: BuildingTemplate[] = [];
  const lookup = (id: string) => buildings.find((b) => b.id === id);
  let placing = false;
  let pick: HTMLSelectElement | null = null;
  let tfSel: HTMLSelectElement | null = null;
  let placeBtn: HTMLButtonElement | null = null;
  const syncPlace = () => {
    if (placeBtn) {
      placeBtn.classList.toggle("on", placing);
      placeBtn.textContent = placing ? "Placing (click to stop)" : "Place building";
    }
  };
  return setupTemplateEditor<SettlementTemplate>({
    key: "settlement",
    title: "Settlement editor",
    legend: SETTLEMENT_LEGEND,
    sizes: [9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31],
    brush: "_",
    fields: [
      { key: "id", label: "Id", kind: "text" },
      { key: "name", label: "Name", kind: "text" },
      { key: "tier", label: "Tier (1-3)", kind: "number", min: 1, max: 3 },
      { key: "weight", label: "weight", kind: "number", min: 0, max: 100 },
      { key: "minStartDist", label: "min dist", kind: "number", min: 0, max: 400 },
      { key: "profile", label: "Profile", kind: "select", options: [...SETTLEMENT_PROFILES] },
      { key: "garrison", label: "Garrison", kind: "json" },
    ],
    newDraft: () => ({
      id: "my-hamlet", name: "My hamlet", tier: 1, weight: 0, minStartDist: 0, profile: "hearthmoor",
      garrison: { townGuard: 2 }, rows: blankRows(17), buildings: [],
    }),
    blankRows,
    validate: (d) => validateSettlementTemplate(d, lookup),
    stats: (d) => {
      try {
        const st = settlementStats(d, lookup);
        return `${SETTLEMENT_TIER_LABEL[d.tier] ?? "?"} ${st.w}x${st.h} · ${st.buildings} buildings · ${st.beds} beds · slots: trader ${st.slots.trader}, priest ${st.slots.priest}, villager ${st.slots.villager}, guard ${st.slots.guard}, quest ${st.slots.quest} · ${st.guards} guards`;
      } catch {
        return "";
      }
    },
    listLabel: (t) => `${t.name} · ${SETTLEMENT_TIER_LABEL[t.tier]} w${t.weight}`,
    stampHint: "Click on the map to stamp the settlement (centred on the click)",
    hooks: {
      controls(api) {
        pick = api.el("select");
        pick.style.maxWidth = "190px";
        tfSel = api.el("select");
        TRANSFORMS.forEach((l, k) => tfSel!.append(api.el("option", l, { value: String(k) })));
        placeBtn = api.button("Place building", () => {
          placing = !placing;
          syncPlace();
        }, "Click the grid to place the picked building (its top-left); right-click a building to remove it");
        const row = api.el("div", "", { class: "te-row" });
        row.append(api.el("span", "Building"), pick, tfSel, placeBtn);
        return [row];
      },
      cell(d, x, y, button, start) {
        if (!start) return placing;
        if (button === 2) {
          const l = settlementLayout(d, lookup);
          const k = l.buildingOf[y * l.w + x];
          if (k >= 0) {
            d.buildings.splice(k, 1);
            return true;
          }
          return false;
        }
        if (!placing || !pick?.value) return false;
        d.buildings.push({ ref: pick.value, x, y, ...(Number(tfSel?.value) ? { transform: Number(tfSel!.value) } : {}) });
        return true;
      },
      drawOver(ctx, d, cs, pad) {
        for (const b of d.buildings) {
          const bt = lookup(b.ref);
          if (!bt) continue;
          const { w, h, cells } = buildingCells(bt, b.transform ?? 0);
          for (const c of cells) {
            ctx.fillStyle = BUILDING_LEGEND[c.ch]?.color ?? "#f0f";
            ctx.fillRect(pad + (b.x + c.x) * cs, pad + (b.y + c.y) * cs, cs, cs);
          }
          ctx.strokeStyle = "#1a3a8a";
          ctx.lineWidth = 2;
          ctx.strokeRect(pad + b.x * cs + 1, pad + b.y * cs + 1, w * cs - 2, h * cs - 2);
          ctx.lineWidth = 1;
        }
      },
      result(m) {
        if (!Array.isArray(m.buildings) || !pick) return;
        buildings = m.buildings as BuildingTemplate[];
        const keep = pick.value;
        pick.replaceChildren(...buildings.map((b) => {
          const o = document.createElement("option");
          o.value = b.id;
          o.textContent = `${b.name} (${b.rows[0].length}x${b.rows.length})`;
          return o;
        }));
        if (buildings.some((b) => b.id === keep)) pick.value = keep;
      },
    },
  }, deps);
}
