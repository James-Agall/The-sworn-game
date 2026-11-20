// Economy panel (DOM): goods stockpile + Market / Gold Shop, left side. Lifted verbatim from main.ts.
import { PROGRESSION, type ItemId } from "@colony/shared/progression";
import { TileType } from "@colony/shared/protocol";
import type { ClientMessage, ServerMessage } from "@colony/shared/protocol";
import { ITEM_ICON } from "./spriteRegistry";
import { COLONIST_ACTION_STATES, FOOD_WORKER_BUSY_STATES } from "./unitVisuals";

export type GoodKey =
  | "wood"
  | "iron"
  | "rock"
  | "gold"
  | "grain"
  | "meat"
  | "fruit"
  | "wool"
  | "cotton"
  | "clothes"
  | "tools"
  | "luxuryItems"
  | "alcohol";

export interface EconomyPanelDeps {
  send: (msg: ClientMessage) => void;
  tileAt: (tx: number, ty: number) => number;
  craftPanelHidden: () => boolean;
  renderCraftPanel: () => void;
}

export interface EconomyPanelUi {
  GOODS_GROUPS: { heading: string; goods: { key: GoodKey; label: string }[] }[];
  latestStock: Partial<Record<GoodKey, number>>;
  setGoodCount(key: string, n: number): void;
  refreshWorkerCounts(colonists: { kind: string; state: string; postX: number; postY: number }[], isNight: boolean): void;
  refreshEconomyPanel(snap: Extract<ServerMessage, { type: "snapshot" }>): void;
}

export function setupEconomyPanel(deps: EconomyPanelDeps): EconomyPanelUi {
  const sendMessage = deps.send;
  const tileAt = deps.tileAt;
  const GOODS_GROUPS: { heading: string; goods: { key: GoodKey; label: string }[] }[] = [
    {
      heading: "Food",
      goods: [
        { key: "grain", label: "Grain" },
        { key: "meat", label: "Meat" },
        { key: "fruit", label: "Fruit" },
      ],
    },
    {
      heading: "Materials",
      goods: [
        { key: "wood", label: "Wood" },
        { key: "iron", label: "Iron" },
        { key: "rock", label: "Rock" },
        { key: "gold", label: "Gold" },
        { key: "wool", label: "Wool" },
        { key: "cotton", label: "Hemp" },
      ],
    },
    {
      heading: "Crafted",
      goods: [
        { key: "clothes", label: "Clothes" },
        { key: "tools", label: "Tools" },
        { key: "luxuryItems", label: "Luxury Items" },
        { key: "alcohol", label: "Alcohol" },
      ],
    },
  ];

  const economyPanel = document.getElementById("economy-panel")!;
  const economyPanelToggle = document.getElementById("economy-panel-toggle")!;
  economyPanelToggle.addEventListener("click", () => {
    economyPanel.classList.toggle("collapsed");
    economyPanelToggle.classList.toggle("panel-open", !economyPanel.classList.contains("collapsed"));
    economyPanelToggle.blur();
  });
  // The latest stock numbers (the Crafting panel's have / need counts).
  const latestStock: Partial<Record<GoodKey, number>> = {};
  const workerCountEls = new Map<string, HTMLSpanElement>();
  const goodsWorkerEls = new Map<GoodKey, HTMLSpanElement>();
  // Which goods group a worker's job feeds: Food (barn farmers, pastures, orchards), Materials
  // (lumberjacks, miners, wool/hemp fields) or Crafted (artisans). Null for non-workers.
  function workerGroup(c: { kind: string; postX: number; postY: number }): string | null {
    switch (c.kind) {
      case "farmer":
        return "Food";
      case "lumberjack":
      case "ironMiner":
      case "rockMiner":
        return "Materials";
      case "artisan":
        return "Crafted";
      case "hunter":
      case "forager":
        return "Food";
      case "farmhand": {
        const t = tileAt(c.postX, c.postY);
        return t === TileType.WoolFarm || t === TileType.CottonFarm ? "Materials" : "Food";
      }
      default:
        return null;
    }
  }
  // The single resource a worker's job produces (artisans by their shop; the Tavern's brewers make gold).
  function workerResource(c: { kind: string; postX: number; postY: number }): GoodKey | null {
    switch (c.kind) {
      case "farmer":
        return "grain";
      case "lumberjack":
        return "wood";
      case "ironMiner":
        return "iron";
      case "rockMiner":
        return "rock";
      case "hunter":
        return "meat";
      case "forager":
        return "fruit";
      case "farmhand": {
        const t = tileAt(c.postX, c.postY);
        return t === TileType.Orchard ? "fruit" : t === TileType.WoolFarm ? "wool" : t === TileType.CottonFarm ? "cotton" : "meat";
      }
      case "artisan": {
        const t = tileAt(c.postX, c.postY);
        return t === TileType.TailorShop
          ? "clothes"
          : t === TileType.Blacksmith
          ? "tools"
          : t === TileType.LuxuryWorkshop
          ? "luxuryItems"
          : t === TileType.Brewery
          ? "alcohol"
          : t === TileType.Tavern
          ? "gold"
          : null;
      }
      default:
        return null;
    }
  }
  // Barn farmers have no work animation of their own (the plots grow while the barn is staffed), so by
  // day they count as working; hunters and foragers count while they're out on a job.
  function isWorkerBusy(c: { kind: string; state: string }, isNight: boolean): boolean {
    if (COLONIST_ACTION_STATES.has(c.state)) return true;
    if (c.kind === "farmer") return !isNight;
    return (c.kind === "hunter" || c.kind === "forager") && FOOD_WORKER_BUSY_STATES.has(c.state);
  }
  function refreshWorkerCounts(colonists: { kind: string; state: string; postX: number; postY: number }[], isNight: boolean) {
    const working: Record<string, number> = { Food: 0, Materials: 0, Crafted: 0 };
    const total: Record<string, number> = { Food: 0, Materials: 0, Crafted: 0 };
    for (const c of colonists) {
      const group = workerGroup(c);
      if (!group) continue;
      total[group]++;
      if (isWorkerBusy(c, isNight)) working[group]++;
    }
    for (const [group, el] of workerCountEls) el.textContent = ` ${working[group]}/${total[group]} working`;
    const resWorking = new Map<GoodKey, number>();
    const resTotal = new Map<GoodKey, number>();
    for (const c of colonists) {
      const res = workerResource(c);
      if (!res) continue;
      resTotal.set(res, (resTotal.get(res) ?? 0) + 1);
      if (isWorkerBusy(c, isNight)) {
        resWorking.set(res, (resWorking.get(res) ?? 0) + 1);
      }
    }
    for (const [res, el] of goodsWorkerEls) {
      const total = resTotal.get(res) ?? 0;
      el.textContent = total > 0 ? ` ${resWorking.get(res) ?? 0}/${total}` : "";
    }
  }
  // Resources panel: every stock resource (GOODS_GROUPS), every progression item (PROGRESSION.items, by its `group`)
  // and the armoury's gear, in collapsible groups (folded state and "hide empty" remembered per browser).
  const goodsListEl = document.getElementById("goods-list")!;
  const GOODS_FOLD_PREF = "sworn.goodsFolded";
  const GOODS_HIDE_ZERO_PREF = "sworn.goodsHideZero";
  const readPref = (k: string): string | null => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  };
  const writePref = (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage blocked: the panel still works */
    }
  };
  let foldedGroups = new Set<string>();
  try {
    foldedGroups = new Set(JSON.parse(readPref(GOODS_FOLD_PREF) ?? "[]") as string[]);
  } catch {
    foldedGroups = new Set();
  }
  // Every row by key: a stock resource ("wood"), an item ("item:hide") or gear ("gear:armour:1").
  const goodsRows = new Map<string, { row: HTMLDivElement; value: HTMLSpanElement }>();
  function setGoodCount(key: string, n: number) {
    const r = goodsRows.get(key);
    if (!r) return;
    const text = String(n);
    if (r.value.textContent !== text) r.value.textContent = text;
    r.row.classList.toggle("zero", n <= 0);
  }
  const showAllBtn = document.createElement("button");
  showAllBtn.id = "goods-show-all";
  const applyHideZero = (hide: boolean) => {
    goodsListEl.classList.toggle("hide-zero", hide);
    showAllBtn.textContent = hide ? "Show all (incl. none in stock)" : "Hide empty";
  };
  applyHideZero(readPref(GOODS_HIDE_ZERO_PREF) === "1");
  showAllBtn.addEventListener("click", () => {
    const hide = !goodsListEl.classList.contains("hide-zero");
    applyHideZero(hide);
    writePref(GOODS_HIDE_ZERO_PREF, hide ? "1" : "0");
    showAllBtn.blur();
  });
  goodsListEl.appendChild(showAllBtn);
  const ITEM_GROUP_HEADING: Record<"food" | "material" | "tool", string> = { food: "Food", material: "Materials", tool: "Crafted" };
  const groupRows: { heading: string; label: string; rows: { key: string; label: string; icon?: string; good?: GoodKey }[] }[] = GOODS_GROUPS.map((g) => ({
    heading: g.heading,
    label: g.heading === "Crafted" ? "Crafted & tools" : g.heading,
    // The resource is Hemp (internal key "cotton" is kept so the protocol stays unchanged).
    rows: g.goods.map((good) => ({ key: good.key, label: good.label, icon: `/sprites/icon-${good.key === "cotton" ? "hemp" : good.key}.png`, good: good.key })),
  }));
  for (const [id, def] of Object.entries(PROGRESSION.items) as [ItemId, (typeof PROGRESSION.items)[ItemId]][]) {
    groupRows.find((g) => g.heading === ITEM_GROUP_HEADING[def.group])!.rows.push({ key: `item:${id}`, label: def.label, icon: ITEM_ICON[`item:${id}`] });
  }
  groupRows.push({
    heading: "Gear",
    label: "Armoury",
    rows: [1, 2, 3].flatMap((t) => [
      { key: `gear:weapon:${t}`, label: `Weapons T${t}`, icon: ITEM_ICON[`gear:weapon:${t}`] },
      { key: `gear:armour:${t}`, label: `Armour T${t}`, icon: ITEM_ICON[`gear:armour:${t}`] },
    ]),
  });
  for (const group of groupRows) {
    const heading = document.createElement("div");
    heading.className = "econ-heading econ-fold";
    heading.append(group.label);
    heading.title = "Click to fold / unfold";
    const workerCount = document.createElement("span");
    workerCount.className = "econ-workers";
    workerCount.title = "Workers working / assigned";
    heading.appendChild(workerCount);
    if (group.heading !== "Gear") workerCountEls.set(group.heading, workerCount);
    const body = document.createElement("div");
    body.className = "econ-group";
    const setFolded = (folded: boolean) => {
      body.hidden = folded;
      heading.classList.toggle("folded", folded);
    };
    setFolded(foldedGroups.has(group.heading));
    heading.addEventListener("click", () => {
      const folded = !body.hidden;
      setFolded(folded);
      if (folded) foldedGroups.add(group.heading);
      else foldedGroups.delete(group.heading);
      writePref(GOODS_FOLD_PREF, JSON.stringify([...foldedGroups]));
    });
    goodsListEl.append(heading, body);
    if (group.heading === "Gear") body.append(document.getElementById("stat-equipment")!);
    for (const good of group.rows) {
      const row = document.createElement("div");
      row.className = "econ-row zero";
      const label = document.createElement("span");
      label.className = "econ-label";
      if (good.icon) {
        const icon = document.createElement("img");
        icon.className = "econ-icon";
        icon.src = good.icon;
        icon.alt = "";
        icon.addEventListener("error", () => icon.remove());
        label.append(icon);
      } else {
        // Items have no icon art yet: a lettered chip stands in.
        const glyph = document.createElement("span");
        glyph.className = "econ-glyph";
        glyph.textContent = good.label.charAt(0);
        label.append(glyph);
      }
      label.append(good.label);
      if (good.good) {
        const workers = document.createElement("span");
        workers.className = "econ-workers-row";
        workers.title = "Workers working / assigned to this resource";
        label.append(workers);
        goodsWorkerEls.set(good.good, workers);
      }
      const value = document.createElement("span");
      value.textContent = "0";
      row.append(label, value);
      body.appendChild(row);
      goodsRows.set(good.key, { row, value });
    }
  }

  // Mirrors the server's EXCHANGE_RATES / GOLD_SHOP_PRICES; the server re-validates every request.
  type BaseResource = "wood" | "iron" | "rock";
  type ShopItem = "tools" | "clothes" | "luxuryItems" | "wood" | "iron" | "rock";
  const RESOURCE_LABEL: Record<string, string> = {
    wood: "Wood",
    iron: "Iron",
    rock: "Rock",
    tools: "Tools",
    clothes: "Clothes",
    luxuryItems: "Luxury Item",
  };
  const MARKET_TRADES: { from: BaseResource; to: BaseResource; give: number; get: number }[] = [
    { from: "wood", to: "iron", give: 3, get: 1 },
    { from: "wood", to: "rock", give: 3, get: 1 },
    { from: "iron", to: "wood", give: 3, get: 1 },
    { from: "iron", to: "rock", give: 2, get: 1 },
    { from: "rock", to: "wood", give: 3, get: 1 },
    { from: "rock", to: "iron", give: 2, get: 1 },
  ];
  const GOLD_SHOP_ITEMS: { item: ShopItem; cost: number; amount: number }[] = [
    { item: "tools", cost: 10, amount: 1 },
    { item: "clothes", cost: 8, amount: 1 },
    { item: "luxuryItems", cost: 20, amount: 1 },
    { item: "wood", cost: 5, amount: 5 },
    { item: "iron", cost: 8, amount: 5 },
    { item: "rock", cost: 8, amount: 5 },
  ];

  const marketSection = document.getElementById("market-section")!;
  const goldShopSection = document.getElementById("gold-shop-section")!;
  const marketButtons: { btn: HTMLButtonElement; from: BaseResource; give: number }[] = [];
  const goldShopButtons: { btn: HTMLButtonElement; cost: number }[] = [];
  function makeEconButton(container: HTMLElement, text: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "econ-btn";
    btn.textContent = text;
    btn.addEventListener("click", () => {
      onClick();
      // Never keep focus: Space is the attack key and would re-trigger a focused button.
      btn.blur();
    });
    container.appendChild(btn);
    return btn;
  }

  const marketBtnsEl = document.getElementById("market-btns")!;
  for (const trade of MARKET_TRADES) {
    const btn = makeEconButton(
      marketBtnsEl,
      `${trade.give} ${RESOURCE_LABEL[trade.from]} → ${trade.get} ${RESOURCE_LABEL[trade.to]}`,
      () => sendMessage({ type: "exchangeResource", from: trade.from, to: trade.to })
    );
    marketButtons.push({ btn, from: trade.from, give: trade.give });
  }

  const goldShopBtnsEl = document.getElementById("gold-shop-btns")!;
  for (const offer of GOLD_SHOP_ITEMS) {
    const btn = makeEconButton(
      goldShopBtnsEl,
      `${offer.amount} ${RESOURCE_LABEL[offer.item]} — ${offer.cost} gold`,
      () => sendMessage({ type: "buyWithGold", item: offer.item })
    );
    goldShopButtons.push({ btn, cost: offer.cost });
  }

  function refreshEconomyPanel(snap: Extract<ServerMessage, { type: "snapshot" }>) {
    for (const g of GOODS_GROUPS) for (const good of g.goods) {
      setGoodCount(good.key, snap[good.key]);
      latestStock[good.key] = snap[good.key];
    }
    if (!deps.craftPanelHidden()) deps.renderCraftPanel();
    // Sections stay hidden (not greyed out) until their building exists.
    marketSection.hidden = !snap.marketBuilt;
    goldShopSection.hidden = !snap.goldShopBuilt;
    for (const { btn, from, give } of marketButtons) btn.disabled = snap[from] < give;
    for (const { btn, cost } of goldShopButtons) btn.disabled = snap.gold < cost;
  }
  return { GOODS_GROUPS, latestStock, setGoodCount, refreshWorkerCounts, refreshEconomyPanel };
}
