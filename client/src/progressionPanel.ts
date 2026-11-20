// Progression tree + Crafting panel + the "Progression & crafting" book (the server's `progression` snapshot).
// Lifted verbatim from main.ts.
import { type ChainStep, type ItemId, PROGRESSION, PROGRESSION_BUILDING_LABEL, QUALITY_GRADES } from "@colony/shared/progression";
import { TileType } from "@colony/shared/protocol";
import type { ClientMessage, ProgressionSnapshot } from "@colony/shared/protocol";
import { ITEM_ICON, iconImg } from "./spriteRegistry";
import { TILE_OPTIONAL_ART, TILE_SPRITE_FILES } from "./worldVisuals";
import { TOOLS } from "./tools";
import type { GoodKey } from "./economyPanel";

export interface ProgressionPanelDeps {
  send: (msg: ClientMessage) => void;
  goodsGroups: { heading: string; goods: { key: GoodKey; label: string }[] }[];
  latestStock: Partial<Record<GoodKey, number>>;
  setGoodCount: (key: string, n: number) => void;
  toolButtonEls: Map<TileType, HTMLButtonElement>;
  refreshBuildRequirements: () => void;
  // Shift+C is Charge in strategy mode with soldiers selected.
  strategyOrderKey: (e: KeyboardEvent) => unknown;
}

export interface ProgressionPanelUi {
  applyProgression(p: ProgressionSnapshot | undefined): void;
  itemTotal(p: ProgressionSnapshot | undefined, id: ItemId): number;
  // Live reads (never copies): the latest snapshot and the build tools it locks.
  latest(): ProgressionSnapshot | undefined;
  locked(): Record<number, string[]>;
  craftPanelEl: HTMLElement;
  renderCraftPanel(force?: boolean): void;
}

export function setupProgressionPanel(deps: ProgressionPanelDeps): ProgressionPanelUi {
  const sendMessage = deps.send;
  const GOODS_GROUPS = deps.goodsGroups;
  const latestStock = deps.latestStock;
  const setGoodCount = deps.setGoodCount;
  const toolButtonEls = deps.toolButtonEls;
  const refreshBuildRequirements = deps.refreshBuildRequirements;
  const strategyOrderKey = deps.strategyOrderKey;
  // ---- Progression tree (shared/src/progression.ts; the server's `progression` snapshot) ----
  // The Build panel keeps the locked "needs: X" tool text and the prospector; hand crafting is the Crafting panel
  // (Craft button / Shift+C); the nearest goals are the Next steps bar (top centre) and its Progression dropdown.
  let progressionLocked: Record<number, string[]> = {};
  let progressionSig = "";
  let latestProgression: ProgressionSnapshot | undefined;
  const progressPanelEl = document.getElementById("progress-panel")!;
  const progressCraftsEl = document.getElementById("progress-crafts")!;
  const nextBarEl = document.getElementById("next-bar")!;
  const nextBarTextEl = document.getElementById("next-bar-text")!;
  const nextBarToggle = document.getElementById("next-bar-toggle") as HTMLButtonElement;
  const progressTreeEl = document.getElementById("progress-tree")!;
  const craftPanelEl = document.getElementById("craft-panel")!;
  const craftListEl = document.getElementById("craft-list")!;
  const craftItemsEl = document.getElementById("craft-items")!;
  const craftSearch=document.createElement("input");craftSearch.type="search";craftSearch.placeholder="Find a recipe or workstation…";craftSearch.setAttribute("aria-label","Search crafting recipes");craftSearch.className="craft-search";craftListEl.before(craftSearch);craftSearch.addEventListener("input",()=>renderCraftPanel(true));
  const itemArt=(id:string)=>ITEM_ICON[`item:${id}`];
  const craftBtn = document.getElementById("craft-btn") as HTMLButtonElement;
  const progressionBook = document.createElement("section");
  progressionBook.id = "progression-book";
  progressionBook.hidden = true;
  progressionBook.setAttribute("role", "dialog");
  progressionBook.setAttribute("aria-label", "Progression and crafting");
  progressionBook.innerHTML = `<header><h2>Progression & crafting</h2><button id="progression-close" aria-label="Close progression">×</button></header><nav aria-label="Progression pages"><button id="progression-chains">Progression</button><button id="progression-recipes">Crafting</button></nav>`;
  document.body.append(progressionBook);
  progressionBook.append(progressTreeEl, craftPanelEl);
  progressTreeEl.removeAttribute("role");
  craftPanelEl.removeAttribute("role");
  nextBarToggle.setAttribute("aria-controls", "progression-book");
  function openProgressionBook(open: boolean, recipes = false) {
    progressionBook.hidden = !open;
    progressTreeEl.hidden = !open || recipes;
    craftPanelEl.hidden = !open || !recipes;
    nextBarToggle.setAttribute("aria-expanded", String(open));
    document.getElementById("progression-chains")!.setAttribute("aria-pressed", String(!recipes));
    document.getElementById("progression-recipes")!.setAttribute("aria-pressed", String(recipes));
    if (open) { if (recipes) renderCraftPanel(true); else renderProgressTree(); }
  }
  document.getElementById("progression-close")!.addEventListener("click", () => openProgressionBook(false));
  document.getElementById("progression-chains")!.addEventListener("click", () => openProgressionBook(true));
  document.getElementById("progression-recipes")!.addEventListener("click", () => openProgressionBook(true, true));

  const itemTotal = (p: ProgressionSnapshot | undefined, id: ItemId) => (p?.items[id] ?? []).reduce((a, b) => a + b, 0);
  const STOCK_LABEL: Record<string, string> = Object.fromEntries(GOODS_GROUPS.flatMap((g) => g.goods.map((good) => [good.key, good.label])));
  const progressionBuildingLabel = (t: TileType) => PROGRESSION_BUILDING_LABEL[t] ?? TOOLS.find((tool) => tool.tile === t)?.label ?? "a building";

  function applyProgression(p: ProgressionSnapshot | undefined) {
    const sig = p ? JSON.stringify(p) : "";
    if (sig === progressionSig) return;
    progressionSig = sig;
    latestProgression = p;
    progressionLocked = p && !p.open ? p.locked : {};
    for (const [tile, btn] of toolButtonEls) {
      const needs = progressionLocked[tile];
      btn.classList.toggle("locked", !!needs);
      btn.title = needs ? `Locked. Needs: ${needs.join(", ")}` : "";
    }
    refreshBuildRequirements();
    for (const id of Object.keys(PROGRESSION.items) as ItemId[]) setGoodCount(`item:${id}`, itemTotal(p, id));
    progressPanelEl.hidden = !p?.prospect;
    nextBarEl.hidden = !p;
    if (!p) {
      progressTreeEl.hidden = true;
      return;
    }
    const next = p.open ? ["Everything is unlocked."] : p.next;
    nextBarTextEl.textContent = next.slice(0, 2).join("  ·  ");
    nextBarTextEl.title = `${next.join("\n")}\n(click for the whole progression)`;
    progressCraftsEl.replaceChildren();
    if (p.prospect) {
      const b = document.createElement("button");
      b.className = "econ-btn";
      b.textContent = p.prospect.label;
      b.disabled = !p.prospect.ok;
      b.title = p.prospect.reason;
      b.addEventListener("click", () => {
        sendMessage({ type: "prospect" });
        b.blur();
      });
      progressCraftsEl.append(b);
    }
    if (!craftPanelEl.hidden) renderCraftPanel();
    if (!progressTreeEl.hidden) renderProgressTree();
  }

  // Crafting panel: every hand recipe with each input's have / need, a Craft button, and "needs: X" when it can't.
  let craftSig = "";
  function renderCraftPanel(force = false) {
    const p = latestProgression;
    const sig = `${progressionSig}|${JSON.stringify(latestStock)}`;
    if (!force && sig === craftSig) return;
    craftSig = sig;
    craftListEl.replaceChildren();
    const nearby=document.createElement("button");nearby.className="cmd-btn";nearby.textContent="Use nearby workstation (all recipes)";nearby.onclick=()=>{sendMessage({type:"heroCraft"});setCraftPanelOpen(false);};craftListEl.append(nearby);
    if (!p) {
      craftListEl.textContent = "Nothing to craft yet.";
      return;
    }
    for (const r of PROGRESSION.recipes) {
      const stationLabel=r.station==="hand"?"By hand":progressionBuildingLabel(r.station);
      if(craftSearch.value&&!`${r.label} ${stationLabel}`.toLowerCase().includes(craftSearch.value.toLowerCase()))continue;
      const hand=r.station==="hand";
      const c = p.crafts.find((x) => x.id === r.id);
      const row = document.createElement("div");
      row.className = "craft-row";
      const main = document.createElement("div");
      main.className = "craft-main";
      const name = document.createElement("div");
      name.className = "craft-name";
      name.textContent = r.label;
      const art=itemArt(r.output);if(art){const image=iconImg(art,40,r.label);image.className="craft-art";row.append(image);}
      const station=document.createElement("div");station.className="craft-station";station.textContent=hand?"Handcrafted":`${stationLabel} · craft personally at the workstation`;main.append(station);
      const have = document.createElement("span");
      have.className = "craft-have";
      have.textContent = `(${itemTotal(p, r.output)} in store${r.amount > 1 ? `, makes ${r.amount}` : ""})`;
      have.title = PROGRESSION.items[r.output].desc;
      name.append(have);
      const inputs = document.createElement("div");
      inputs.className = "craft-in";
      const parts: [string, number, number][] = [
        ...(Object.entries(r.stock ?? {}) as [string, number][]).map(([k, n]): [string, number, number] => [STOCK_LABEL[k] ?? k, latestStock[k as GoodKey] ?? 0, n]),
        ...(Object.entries(r.items ?? {}) as [ItemId, number][]).map(([id, n]): [string, number, number] => [PROGRESSION.items[id].label, itemTotal(p, id), n]),
      ];
      parts.forEach(([label, got, need], i) => {
        const span = document.createElement("span");
        span.textContent = `${label} ${Math.floor(got)}/${need}`;
        if (got < need) span.className = "short";
        inputs.append(...(i > 0 ? [" + "] : []), span);
      });
      main.append(name, inputs);
      const ok = p.open || (hand ? (c?.ok ?? false) : (p.built??[]).includes(r.station as TileType));
      if (!ok) {
        const why = hand ? c?.why ?? "" : `Needs ${stationLabel}`;
        const needs = document.createElement("div");
        needs.className = "craft-needs";
        needs.textContent = `needs: ${why.replace(/^Needs /, "").replace(/^Not enough (.*)$/, "more $1") || "its inputs"}`;
        main.append(needs);
      }
      const b = document.createElement("button");
      b.className = "econ-btn";
      b.textContent = hand ? "Craft" : "Craft here";
      b.disabled = !ok;
      b.addEventListener("click", () => {
        if(hand) sendMessage({ type: "craftItem", recipe: r.id });
        else sendMessage({type:"heroCraft",recipe:r.id});
        b.blur();
      });
      row.append(main, b);
      craftListEl.append(row);
    }
    const owned = Object.entries(p.items).map(([id, grades]) => {
      const label = PROGRESSION.items[id as ItemId]?.label ?? id;
      const total = grades.reduce((a, b) => a + b, 0);
      const fine = grades.slice(1).some((n) => n > 0) ? ` (${grades.map((n, i) => (n > 0 ? `${n} ${QUALITY_GRADES[i].label}` : "")).filter(Boolean).join(", ")})` : "";
      return `${label} ${total}${fine}`;
    });
    craftItemsEl.textContent = owned.length > 0 ? `Items in store: ${owned.join(", ")}` : "Items in store: none";
  }
  function setCraftPanelOpen(open: boolean) {
    openProgressionBook(open, true);
  }
  craftBtn.addEventListener("click", () => {
    craftBtn.blur();
    setCraftPanelOpen(craftPanelEl.hidden);
  });
  document.getElementById("craft-close")!.addEventListener("click", () => setCraftPanelOpen(false));
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !craftPanelEl.hidden) setCraftPanelOpen(false);
    if (e.key === "Escape" && !progressTreeEl.hidden) setProgressTreeOpen(false);
    if (e.code !== "KeyC" || !e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
    if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select")) return;
    // Strategy mode with soldiers selected: Shift+C is Charge.
    if (strategyOrderKey(e)) return;
    e.preventDefault();
    setCraftPanelOpen(craftPanelEl.hidden);
  });

  // Progression dropdown: every chain of PROGRESSION.chains, each step done / available / locked with its needs.
  function chainStepState(p: ProgressionSnapshot, st: ChainStep): { label: string; cls: "done" | "avail" | "locked"; note: string } {
    const built = new Set(p.built ?? []);
    if (st.building !== undefined) {
      const label = progressionBuildingLabel(st.building);
      if (built.has(st.building)) return { label, cls: "done", note: "built" };
      const needs = p.open ? undefined : p.locked[st.building];
      return needs ? { label, cls: "locked", note: `needs: ${needs.join(", ")}` } : { label, cls: "avail", note: "can be built" };
    }
    const id = st.item;
    const label = PROGRESSION.items[id].label;
    const have = itemTotal(p, id);
    if (have > 0) return { label, cls: "done", note: `${have} in store` };
    const r = PROGRESSION.recipes.find((rc) => rc.output === id);
    if (!r) return { label, cls: "avail", note: PROGRESSION.items[id].desc.split(".")[0] };
    if (r.station === "hand") {
      const c = p.crafts.find((x) => x.id === r.id);
      if (p.open || c?.ok) return { label, cls: "avail", note: `craft by hand: ${c?.cost ?? ""}` };
      if (c?.why?.startsWith("Needs ")) return { label, cls: "locked", note: `needs: ${c.why.slice(6)}` };
      return { label, cls: "avail", note: `craft by hand: ${c?.cost ?? ""} (${(c?.why ?? "").toLowerCase()})` };
    }
    const station = progressionBuildingLabel(r.station);
    const lvl = r.workerLevel && r.workerLevel > 1 ? `, a level-${r.workerLevel} worker` : "";
    const kept = Object.keys(r.needs ?? {}).map((k) => `, a ${PROGRESSION.items[k as ItemId].label}`).join("");
    if (p.open || built.has(r.station)) return { label, cls: "avail", note: `made at the ${station}${lvl}${kept}` };
    return { label, cls: "locked", note: `needs: a ${station}${lvl}${kept}` };
  }
  function renderProgressTree() {
    const p = latestProgression;
    progressTreeEl.replaceChildren();
    if (!p) return;
    const legend = document.createElement("div");
    legend.className = "pt-legend";
    for (const [cls, text] of [["done", "done"], ["avail", "available now"], ["locked", "locked (needs shown)"]]) {
      const item = document.createElement("span");
      const sw = document.createElement("span");
      sw.className = `pt-swatch ${cls}`;
      item.append(sw, text);
      legend.append(item);
    }
    progressTreeEl.append(legend);
    for (const chain of PROGRESSION.chains) {
      const box = document.createElement("div");
      box.className = "pt-chain";
      const name = document.createElement("div");
      name.className = "pt-name";
      name.textContent = chain.label;
      const steps = document.createElement("div");
      steps.className = "pt-steps";
      chain.steps.forEach((st, i) => {
        const s = chainStepState(p, st);
        if (i > 0) {
          const arrow = document.createElement("span");
          arrow.className = "pt-arrow";
          arrow.textContent = "\u2192";
          steps.append(arrow);
        }
        const chip = document.createElement("div");
        chip.className = `pt-step ${s.cls}`;
        const b = document.createElement("b");
        b.textContent = s.label;
        const small = document.createElement("small");
        small.textContent = s.note;
        const art=st.building!==undefined?((TILE_OPTIONAL_ART[st.building]??TILE_SPRITE_FILES[st.building])?`/sprites/${TILE_OPTIONAL_ART[st.building]??TILE_SPRITE_FILES[st.building]}.png`:undefined):itemArt(st.item);
        if(art){const image=iconImg(art,36,s.label);image.className="pt-art";chip.append(image);}
        chip.append(b, small);
        chip.title = `${s.label}: ${s.note}`;
        steps.append(chip);
      });
      box.append(name, steps);
      progressTreeEl.append(box);
    }
  }
  function setProgressTreeOpen(open: boolean) {
    openProgressionBook(open);
  }
  nextBarToggle.addEventListener("click", () => {
    nextBarToggle.blur();
    setProgressTreeOpen(progressionBook.hidden);
  });
  nextBarTextEl.addEventListener("click", () => setProgressTreeOpen(progressionBook.hidden));
  return { applyProgression, itemTotal, latest: () => latestProgression, locked: () => progressionLocked, craftPanelEl, renderCraftPanel };
}
