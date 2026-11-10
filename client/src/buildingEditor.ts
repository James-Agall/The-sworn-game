// buildingEditor.ts: the creative-mode building template editor (templateEditor.ts with the building legend and
// metadata of shared/src/buildingTemplates.ts): paint walls / doors / windows / floors / furniture / stations / annexes /
// slots, set the type, tier, door side, role, rotate / mirror; see the rooms, cost and needs live; Save / Load /
// Duplicate / Delete; "Stamp here" builds it at once at the next map click (creativeSet building* ops).
import {
  BUILDING_LEGEND, BUILDING_TYPES, type BuildingTemplate, buildingCostText, buildingStats, validateBuildingTemplate,
} from "@colony/shared/buildingTemplates";
import { transformEntrance, transformRows } from "@colony/shared/camps";
import { type EditorDeps, setupTemplateEditor } from "./templateEditor";

function blankRows(n: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < n; y++) {
    let r = "";
    for (let x = 0; x < n; x++) r += y === 0 || x === 0 || x === n - 1 || y === n - 1 ? "#" : "=";
    rows.push(r);
  }
  const c = n >> 1;
  rows[n - 1] = rows[n - 1].slice(0, c) + "+" + rows[n - 1].slice(c + 1);
  rows[1] = rows[1].slice(0, 1) + "b" + rows[1].slice(2);
  return rows;
}

export function setupBuildingEditor(deps: EditorDeps) {
  return setupTemplateEditor<BuildingTemplate>({
    key: "building",
    title: "Building editor",
    legend: BUILDING_LEGEND,
    sizes: [3, 4, 5, 6, 7, 8, 9, 11, 13, 15],
    brush: "#",
    fields: [
      { key: "id", label: "Id", kind: "text" },
      { key: "name", label: "Name", kind: "text" },
      { key: "buildingType", label: "Type", kind: "select", options: [...BUILDING_TYPES] },
      { key: "tier", label: "Tier", kind: "number", min: 1, max: 3 },
      { key: "role", label: "Role", kind: "select", options: ["bedroom", "barracks", "kitchen", "workshop", "hall", "storeroom", "church", "infirmary"] },
      { key: "doorSide", label: "Door", kind: "select", options: ["N", "E", "S", "W"] },
      { key: "rotate", label: "may rotate", kind: "check" },
      { key: "mirror", label: "may mirror", kind: "check" },
    ],
    newDraft: () => ({ id: "my-house", name: "My house", buildingType: "house", tier: 1, doorSide: "S", rotate: true, mirror: true, role: "bedroom", rows: blankRows(5) }),
    blankRows,
    validate: validateBuildingTemplate,
    stats: (d) => {
      try {
        const st = buildingStats(d);
        return `${st.w}x${st.h} · rooms ${st.rooms.map((r) => r.role).join(" + ") || "none"} · ${st.beds} beds · cost ${buildingCostText(st.cost)}${st.needs.length ? ` · needs ${st.needs.join(", ")}` : ""}`;
      } catch {
        return "";
      }
    },
    transform: (d, tf) => {
      d.rows = transformRows(d.rows, tf);
      d.doorSide = transformEntrance(d.doorSide, tf);
    },
    listLabel: (t) => `${t.name} · ${t.buildingType} T${t.tier}`,
    stampHint: "Click on the map to build it at once (centred on the click)",
  }, deps);
}
