// Building info panel (staffing, upgrade / repair, gates, mines, levy, training, forge, heroes, keep, wagons,
// vassals, trading post, rooms, work posts) plus the trade, quest, work and chronicle panels.
// Split out of main.ts (2026-11-26).
import { setupChronicle } from "../chronicle";
import { Application, Container, Graphics } from "pixi.js";
import { createAnimalPanel } from "../animals";
import { ROOM_STAT_ICON, iconImg, roomRoleIconUrl } from "../spriteRegistry";
import { setupWork } from "../work";
import { WORK_LABEL } from "@colony/shared/work";
import { NEW_STRUCTURE_TILES } from "@colony/shared/structures";
import { setupAdventureJournal, adventureMapMarker } from "../adventureJournal";
import { type InteriorUi } from "../interior";
import { MINE_RISK_LABEL } from "@colony/shared/mines";
import type { ClientMessage, QuestSnapshot, TradeGood, ColonistKind, BuildingInfo, GateLock, EquipSlot, HeroClass } from "@colony/shared/protocol";
import { TICK_RATE } from "@colony/shared/protocol";
import { RELATION_TIER_NAMES } from "@colony/shared/protocol";
import { TileType } from "@colony/shared/protocol";
import { SIEGE_KINDS, HERO_CLASSES, HERO_CLASS_LABEL } from "@colony/shared/protocol";
import type { SiegeKind } from "@colony/shared/protocol";
import { SPELLS } from "@colony/shared/protocol";
import { StrategyCamera } from "../strategy/camera";
import type { GameEventCategory } from "@colony/shared/protocol";

// Closure state from main.ts. Plain fields are fixed references (objects mutated in place, functions); the
// readonly / settable ones are live getters (or setters) onto main's `let` variables.
export interface BuildingPanelContext {
  sendMessage: (msg: object) => void;
  strategyCam: StrategyCamera;
  worldLayer: Container;
  app: Application;
  interiorRef: { ui: InteriorUi | null };
  readonly selectedIds: Set<string>;
  readonly pushEventToast: (category: GameEventCategory, text: string) => void;
  fightPeek: { x: number; y: number; until: number } | null;
  readonly tileSize: number;
  readonly questCycleTicks: number;
  readonly latestQuests: QuestSnapshot[];
  readonly questSeen: Set<number>;
  readonly bpTrainBatchBtns: [number | "max", HTMLButtonElement][];
  readonly bpTrainCancelBtn: HTMLButtonElement;
}

export function createBuildingPanel(game: BuildingPanelContext) {
  const { sendMessage, strategyCam, worldLayer, app, interiorRef } = game;
  // ---- Building info panel (left-click a building; see the pointerup handler) ----
  // Buildings that open the panel. Walls, trees, rocks and forage keep the old left-click (break).
  const INFO_TILES = new Set<number>([
    TileType.TownCenter, TileType.House, TileType.BigHouse, TileType.HouseLevel2, TileType.BarnPost,
    TileType.LumberjackPost, TileType.FarmPlot, TileType.KnightPost, TileType.CastleLevel2, TileType.CastleLevel3,
    TileType.ArcherPost, TileType.Tower, TileType.IronMinePost, TileType.RockMinePost, TileType.ChurchPost,
    TileType.Pasture, TileType.PigPasture, TileType.Orchard, TileType.WoolFarm, TileType.CottonFarm, TileType.TailorShop,
    TileType.Blacksmith, TileType.LuxuryWorkshop, TileType.Market, TileType.GoldShop, TileType.Brewery,
    TileType.Tavern, TileType.MilitiaPost, TileType.MilitiaCamp2, TileType.MilitiaCamp3, TileType.WardStone,
    TileType.HunterHut, TileType.ForagerHut, TileType.BuildersGuild, TileType.ConstructionSite,
    TileType.Gate, TileType.FenceGate, TileType.Drawbridge, TileType.Stables, TileType.SiegeWorkshop, TileType.Keep,
    TileType.SiteKeep, TileType.RuinedKeep, TileType.Tent, TileType.CharcoalBurner, TileType.Bloomery, TileType.Mill, TileType.Bakery,
    TileType.ClayPit, TileType.Kiln, TileType.ChickenCoop, TileType.LivestockBarn, TileType.PigSty, TileType.SheepPen,
    TileType.CoalMine, TileType.CopperMine, TileType.TinMine,
    TileType.SaltWorks, TileType.Smokehouse, TileType.Dairy, TileType.Cellar,
    TileType.Foundry, TileType.StampMill, TileType.LimeQuarry, TileType.GoldMine, TileType.LeadMine, TileType.Glassworks, TileType.Mint,
    ...NEW_STRUCTURE_TILES,
  ]);
  const buildingPanelEl = document.getElementById("building-panel")!;
  const bpNameEl = document.getElementById("bp-name")!;
  const bpLevelEl = document.getElementById("bp-level")!;
  const bpStaffingEl = document.getElementById("bp-staffing")!;
  const bpHpEl = document.getElementById("bp-hp")!;
  const bpConstructionEl = document.getElementById("bp-construction")!;
  const bpBonusesEl = document.getElementById("bp-bonuses")!;
  const bpUpgradeRowEl = document.getElementById("bp-upgrade-row")!;
  const bpUpgradeBtn = document.getElementById("bp-upgrade") as HTMLButtonElement;
  const bpUpgradeCostEl = document.getElementById("bp-upgrade-cost")!;
  const bpRepairRowEl = document.getElementById("bp-repair-row")!;
  const bpRepairBtn = document.getElementById("bp-repair") as HTMLButtonElement;
  const bpRepairCostEl = document.getElementById("bp-repair-cost")!;
  // Walls & gates: the gate's lock (click cycles auto -> open -> closed).
  const bpGateRowEl = document.getElementById("bp-gate-row")!;
  const bpGateBtn = document.getElementById("bp-gate-lock") as HTMLButtonElement;
  const bpGateStateEl = document.getElementById("bp-gate-state")!;
  const GATE_LOCK_NEXT: Record<GateLock, GateLock> = { auto: "open", open: "closed", closed: "auto" };
  const GATE_LOCK_LABEL: Record<GateLock, string> = { auto: "Auto", open: "Locked open", closed: "Locked closed" };
  let shownGateLock: GateLock = "auto";
  // Modular building phase 1: a blueprint's Priority / Cancel buttons (siteOrder).
  const bpBlueprintRowEl = document.createElement("div");
  bpBlueprintRowEl.style.cssText = "display: none; align-items: center; gap: 8px; margin-top: 8px;";
  const bpPriorityBtn = document.createElement("button");
  const bpCancelBtn = document.createElement("button");
  bpPriorityBtn.className = bpCancelBtn.className = "econ-btn";
  bpBlueprintRowEl.append(bpPriorityBtn, bpCancelBtn);
  bpGateRowEl.after(bpBlueprintRowEl);
  // Modular building phase 2: the Room section (role, stats, score, effects, tips) for anything inside a room.
  const bpRoomEl = document.createElement("div");
  bpRoomEl.style.cssText = "display: none; margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.15); padding-top: 6px;";
  bpBonusesEl.before(bpRoomEl);
  const ROOM_STAT_TIPS: Record<string, string> = {
    Size: "Tiles for its role (a bedroom wants 6 per bed, a kitchen / workshop 12, a hall 30)",
    Beauty: "Furniture (rugs, statues, lamps), wood / stone floors; bare ground is ugly",
    Cleanliness: "Dirt from people walking through and blood; swept clean over time; damaged walls count as rubble",
    Warmth: "Hearths, lamps and ovens / forges; a stone roof helps, windows lose heat; one hearth warms 16 tiles best",
  };
  function renderRoom(room: BuildingInfo["room"]) {
    bpRoomEl.style.display = room ? "block" : "none";
    if (!room) return;
    const head = document.createElement("div");
    head.className = "menu-section";
    const badge = roomRoleIconUrl(room.role);
    if (badge) head.append(iconImg(badge, 18, room.roleLabel), " ");
    head.append(`Room: ${room.roleLabel}, ${room.tier} (${room.score}/100)`);
    head.title = "Score = 15% size + 35% beauty + 25% cleanliness + 25% warmth";
    const stats = document.createElement("div");
    stats.style.cssText = "display: grid; grid-template-columns: auto 1fr auto; gap: 2px 6px; align-items: center; font-size: 12px;";
    for (const [label, v] of [["Size", room.size], ["Beauty", room.beauty], ["Cleanliness", room.cleanliness], ["Warmth", room.warmth]] as const) {
      const name = document.createElement("span");
      name.append(iconImg(ROOM_STAT_ICON[label], 14), " ", label);
      name.title = ROOM_STAT_TIPS[label];
      const bar = document.createElement("div");
      bar.style.cssText = "height: 6px; background: rgba(255,255,255,0.12); border-radius: 3px; overflow: hidden;";
      bar.title = ROOM_STAT_TIPS[label];
      const fill = document.createElement("div");
      fill.style.cssText = `height: 100%; width: ${v}%; background: ${v >= 70 ? "#7fc97f" : v >= 40 ? "#e0c060" : "#e07060"};`;
      bar.append(fill);
      const num = document.createElement("span");
      num.textContent = String(v);
      stats.append(name, bar, num);
    }
    const list = (items: string[], color: string) => {
      const ul = document.createElement("ul");
      ul.style.cssText = `margin: 4px 0 0 0; padding-left: 16px; font-size: 12px; color: ${color};`;
      for (const t of items) {
        const li = document.createElement("li");
        li.textContent = t;
        ul.append(li);
      }
      return ul;
    };
    const contents = document.createElement("div");
    contents.style.cssText = "font-size: 12px; opacity: 0.8; margin-top: 4px;";
    contents.textContent = `Contents: ${room.contents}`;
    bpRoomEl.replaceChildren(head, stats, contents, list(room.effects, "#bfe3bf"), ...(room.tips.length ? [list(room.tips.map((t) => `Tip: ${t}`), "#f0d890")] : []));
  }
  for (const [btn, action] of [[bpPriorityBtn, "priority"], [bpCancelBtn, "cancel"]] as const) {
    btn.addEventListener("click", () => {
      btn.blur();
      if (!infoTile) return;
      sendMessage({ type: "siteOrder", tileX: infoTile.tx, tileY: infoTile.ty, action });
      window.setTimeout(requestBuildingInfo, 150);
    });
  }
  // Cavalry & siege: the Siege Workshop's two build buttons (queueSiege) and its status line.
  const bpSiegeRowEl = document.getElementById("bp-siege-row")!;
  const bpSiegeStateEl = document.getElementById("bp-siege-state")!;
  const bpSiegeBtns = new Map<SiegeKind, HTMLButtonElement>(
    SIEGE_KINDS.map((kind) => [kind, document.getElementById(`bp-siege-${kind}`) as HTMLButtonElement])
  );
  // Village life phase 3: a unit building's Train unit button (trainUnit) and its troops / reason line.
  const bpTrainRowEl = document.getElementById("bp-train-row")!;
  const bpTrainBtn = document.getElementById("bp-train") as HTMLButtonElement;
  const bpTrainStateEl = document.getElementById("bp-train-state")!;
  // Village life phase 4: a Town Center's Call to arms / Stand down button (callVillagers) and its levy line.
  const bpLevyRowEl = document.getElementById("bp-levy-row")!;
  const bpLevyBtn = document.getElementById("bp-levy") as HTMLButtonElement;
  const bpLevyStateEl = document.getElementById("bp-levy-state")!;
  // Deep mines: an own mine's status and the "Send soldiers in" button (mineAssault).
  const bpMineRowEl = document.getElementById("bp-mine-row")!;
  const bpMineBtn = document.getElementById("bp-mine-assault") as HTMLButtonElement;
  const bpMineStateEl = document.getElementById("bp-mine-state")!;
  // Mines: the next depth's nest risk before the upgrade digs it; a risky dig takes a second click to confirm.
  const bpMineRiskEl = document.getElementById("bp-mine-risk")!;
  let mineDigPreview: { level: number; chance: number; risk: string } | null = null;
  let mineDigArmedUntil = 0;
  let shownLevyOnField = 0;
  // Armour & weapons: the Blacksmith's two forge buttons (queueForge) and its queue line.
  const bpForgeRowEl = document.getElementById("bp-forge-row")!;
  const bpForgeStateEl = document.getElementById("bp-forge-state")!;
  // Forge autocraft: on / off toggle, target - / + (setForgeAuto), and its status line.
  const bpForgeAutoBtn = document.getElementById("bp-forge-auto") as HTMLButtonElement;
  const bpForgeAutoLessBtn = document.getElementById("bp-forge-auto-less") as HTMLButtonElement;
  const bpForgeAutoMoreBtn = document.getElementById("bp-forge-auto-more") as HTMLButtonElement;
  const bpForgeAutoStateEl = document.getElementById("bp-forge-auto-state")!;
  let shownForgeAuto: { on: boolean; target: number } = { on: false, target: 4 };
  const bpForgeBtns = new Map<EquipSlot, HTMLButtonElement>(
    (["armour", "weapon"] as EquipSlot[]).map((slot) => [slot, document.getElementById(`bp-forge-${slot}`) as HTMLButtonElement])
  );
  // Hero phase 3: the Keep's three recruit buttons (recruitHero) and its hero roster line.
  const bpHeroesRowEl = document.getElementById("bp-heroes-row")!;
  const bpHeroesStateEl = document.getElementById("bp-heroes-state")!;
  const bpHeroBtns = new Map<HeroClass, HTMLButtonElement>(
    HERO_CLASSES.map((cls) => [cls, document.getElementById(`bp-hero-${cls}`) as HTMLButtonElement])
  );
  const bpSpellsRowEl = document.getElementById("bp-spells-row")!;
  // Forts phase B: a razed fort's RuinedKeep: Rebuild (rebuildKeep) and its cost / reason.
  const bpKeepRowEl = document.getElementById("bp-keep-row")!;
  const bpKeepBtn = document.getElementById("bp-keep-rebuild") as HTMLButtonElement;
  const bpKeepStateEl = document.getElementById("bp-keep-state")!;
  let bpSpellsKey = "";
  // Forts phase D: a human settlement's Trade button and the trade panel (fed by the same buildingInfo
  // refresh while open; closes with the building panel).
  // Forts phase E: the Trading Post's trader wagon (status, escort, destinations, send / recall / auto).
  const bpWagonRowEl = document.getElementById("bp-wagon-row")!;
  const bpWagonStatusEl = document.getElementById("bp-wagon-status")!;
  const bpWagonEscortEl = document.getElementById("bp-wagon-escort")!;
  const bpWagonDestEl = document.getElementById("bp-wagon-dest") as HTMLSelectElement;
  const bpWagonSendBtn = document.getElementById("bp-wagon-send") as HTMLButtonElement;
  const bpWagonRecallBtn = document.getElementById("bp-wagon-recall") as HTMLButtonElement;
  const bpWagonAutoBtn = document.getElementById("bp-wagon-auto") as HTMLButtonElement;
  const bpWagonDestsEl = document.getElementById("bp-wagon-dests")!;
  let bpWagonAuto = true;
  let bpWagonDestKey = "";
  // Batch 2 (SPRITES.md #67 / #80): a small optional icon (/sprites/ui-<icon>.png) ahead of a panel line's
  // text; the img is made once per icon and removes itself if the file is missing, leaving just the text.
  function setIconText(el: HTMLElement, icon: string, text: string) {
    if (el.dataset.icon !== icon) {
      el.dataset.icon = icon;
      const img = document.createElement("img");
      img.className = "ui-ico";
      img.alt = "";
      img.src = `/sprites/ui-${icon}.png`;
      img.onerror = () => img.remove();
      el.replaceChildren(img, document.createTextNode(text));
    } else if (el.lastChild!.textContent !== text) el.lastChild!.textContent = text;
  }
  const relIcon = (tier: keyof typeof RELATION_TIER_NAMES) => `rel${Object.keys(RELATION_TIER_NAMES).indexOf(tier)}`;
  const ESCORT_LABEL: Partial<Record<ColonistKind, string>> = { militia: "Militia", spearman: "Spearman", pikeman: "Pikeman", cavalry: "Cavalry" };
  function renderTradingPost(tp: BuildingInfo["tradingPost"]) {
    bpWagonRowEl.hidden = !tp;
    if (!tp) return;
    const w = tp.wagon;
    setIconText(bpWagonStatusEl, w && w.hp < w.maxHp ? "tradeAlert" : "tradeRoute", `${w ? `Wagon HP ${w.hp}/${w.maxHp} · ` : ""}${tp.status}`);
    bpWagonEscortEl.textContent = `Escort: ${tp.escorts.map((e) => `${ESCORT_LABEL[e.kind] ?? e.kind}${e.alive ? "" : " (fallen)"}`).join(", ")}`;
    const key = tp.destinations.map((d) => `${d.id}:${d.ok}`).join("|");
    if (key !== bpWagonDestKey) {
      bpWagonDestKey = key;
      const keep = bpWagonDestEl.value;
      bpWagonDestEl.replaceChildren(
        new Option("Auto (best)", "auto"),
        ...tp.destinations.filter((d) => d.ok).map((d) => new Option(d.name, d.id))
      );
      bpWagonDestEl.value = Array.from(bpWagonDestEl.options).some((o) => o.value === keep) ? keep : "auto";
    }
    bpWagonSendBtn.disabled = !tp.canSend;
    bpWagonSendBtn.title = tp.sendReason;
    bpWagonRecallBtn.disabled = !tp.canRecall;
    bpWagonAuto = tp.auto;
    bpWagonAutoBtn.textContent = `Auto-send: ${tp.auto ? "On" : "Off"}`;
    bpWagonDestsEl.replaceChildren(
      ...(tp.destinations.length > 0 ? tp.destinations : [null]).map((d) => {
        const li = document.createElement("li");
        if (!d) {
          li.textContent = "No destinations yet: befriend a settlement (Friendly) or found another Town Center";
          return li;
        }
        const own = d.kind === "own" ? " (own, half value)" : "";
        li.textContent = d.ok
          ? `${d.name}${own}: ${d.dist} tiles, ${d.danger ?? "road not scouted"}, ~${d.profit} gold`
          : `${d.name}${own}: ${d.reason}`;
        if (!d.ok) li.className = "off";
        return li;
      })
    );
  }
  bpWagonSendBtn.addEventListener("click", () => {
    bpWagonSendBtn.blur();
    if (!infoTile) return;
    sendMessage({ type: "wagonCommand", tileX: infoTile.tx, tileY: infoTile.ty, cmd: "sendNow", dest: bpWagonDestEl.value || "auto" });
    window.setTimeout(requestBuildingInfo, 150);
  });
  bpWagonRecallBtn.addEventListener("click", () => {
    bpWagonRecallBtn.blur();
    if (!infoTile) return;
    sendMessage({ type: "wagonCommand", tileX: infoTile.tx, tileY: infoTile.ty, cmd: "recall" });
    window.setTimeout(requestBuildingInfo, 150);
  });
  bpWagonAutoBtn.addEventListener("click", () => {
    bpWagonAutoBtn.blur();
    if (!infoTile) return;
    sendMessage({ type: "wagonCommand", tileX: infoTile.tx, tileY: infoTile.ty, cmd: "auto", value: !bpWagonAuto });
    window.setTimeout(requestBuildingInfo, 150);
  });
  // Forts phase F: a vassal's block (power, Call to arms / Dismiss, Demand tribute, the tribute ledger).
  const bpVassalRowEl = document.getElementById("bp-vassal-row")!;
  const bpVassalPowerEl = document.getElementById("bp-vassal-power")!;
  const bpVassalCallBtn = document.getElementById("bp-vassal-call") as HTMLButtonElement;
  const bpVassalDismissBtn = document.getElementById("bp-vassal-dismiss") as HTMLButtonElement;
  const bpVassalLevyEl = document.getElementById("bp-vassal-levy")!;
  const bpVassalTaxBtn = document.getElementById("bp-vassal-tax") as HTMLButtonElement;
  const bpVassalTaxStateEl = document.getElementById("bp-vassal-tax-state")!;
  const bpVassalLedgerEl = document.getElementById("bp-vassal-ledger")!;
  let bpVassalTax = false;
  function renderVassal(v: BuildingInfo["vassal"]) {
    bpVassalRowEl.hidden = !v;
    if (!v) return;
    setIconText(bpVassalPowerEl, "vassal", `Your vassal. Power: yours ${v.clanPower}, theirs ${v.sitePower} (they break free if stronger than you)`);
    bpVassalCallBtn.disabled = !v.canCall;
    bpVassalCallBtn.title = v.canCall ? `${v.levySize} levies join you for a day${strategyCam.inStrategy && game.selectedIds.size > 0 ? " and follow your selected army" : " and follow you"}` : v.callReason;
    bpVassalDismissBtn.hidden = v.levyOnField === 0 || v.levyReturning;
    setIconText(bpVassalLevyEl, "callToArms", `Levy: ${v.levyStatus}${v.canCall ? ` (${v.levySize} would march)` : ""}`);
    bpVassalTax = v.tax;
    bpVassalTaxBtn.textContent = `Demand tribute: ${v.tax ? "On" : "Off"}`;
    bpVassalTaxBtn.disabled = !v.tax && !v.canTax;
    bpVassalTaxBtn.title = v.canTax || v.tax ? "Take a share of their stock and purse every 2 days (costs relation)" : v.taxReason;
    bpVassalTaxStateEl.textContent = v.canTax ? `Estimate: ${v.estimate}` : v.taxReason;
    setIconText(bpVassalLedgerEl, "tribute", `Tribute: last ${v.lastTax} · next ${v.nextTax} · total ${v.taxGoldTotal} gold`);
  }
  bpVassalCallBtn.addEventListener("click", () => {
    bpVassalCallBtn.blur();
    if (!infoTile) return;
    // Strategy mode: the levy joins the selected army (follows its first unit); otherwise it follows the player.
    const follow = strategyCam.inStrategy && game.selectedIds.size > 0 ? [...game.selectedIds][0] : undefined;
    sendMessage({ type: "callToArms", tileX: infoTile.tx, tileY: infoTile.ty, ...(follow ? { followId: follow } : {}) });
    window.setTimeout(requestBuildingInfo, 150);
  });
  bpVassalDismissBtn.addEventListener("click", () => {
    bpVassalDismissBtn.blur();
    if (!infoTile) return;
    sendMessage({ type: "callToArms", tileX: infoTile.tx, tileY: infoTile.ty, dismiss: true });
    window.setTimeout(requestBuildingInfo, 150);
  });
  bpVassalTaxBtn.addEventListener("click", () => {
    bpVassalTaxBtn.blur();
    if (!infoTile) return;
    sendMessage({ type: "setTax", tileX: infoTile.tx, tileY: infoTile.ty, on: !bpVassalTax });
    window.setTimeout(requestBuildingInfo, 150);
  });
  const bpTradeRowEl = document.getElementById("bp-trade-row")!;
  const bpTradeBtn = document.getElementById("bp-trade-open") as HTMLButtonElement;
  const bpTradeStateEl = document.getElementById("bp-trade-state")!;
  const tradePanelEl = document.getElementById("trade-panel")!;
  const tpNameEl = document.getElementById("tp-name")!;
  const tpRelationEl = document.getElementById("tp-relation")!;
  const tpReasonEl = document.getElementById("tp-reason")!;
  const tpFootEl = document.getElementById("tp-foot")!;
  const tpBodyEl = document.querySelector("#tp-goods tbody")!;
  const TRADE_GOOD_LABEL: Record<TradeGood, string> = {
    grain: "Grain", meat: "Meat", fruit: "Fruit", wool: "Wool", wood: "Wood", rock: "Rock", iron: "Iron", clothes: "Cloth", tools: "Tools",
  };
  let tradeOpen = false;
  let tradeKey = "";
  function sendTrade(good: TradeGood, qty: number, side: "buy" | "sell") {
    if (!infoTile) return;
    sendMessage({ type: "tradeWithSite", tileX: infoTile.tx, tileY: infoTile.ty, good, qty, side });
    window.setTimeout(requestBuildingInfo, 150);
  }
  function renderTrade(trade: BuildingInfo["trade"]) {
    tradePanelEl.hidden = !tradeOpen || !trade;
    if (!trade || !tradeOpen) return;
    tpNameEl.textContent = `Trade: ${trade.siteName}`;
    const pct = Math.round((1 - trade.discount) * 100);
    setIconText(tpRelationEl, relIcon(trade.tier), `${RELATION_TIER_NAMES[trade.tier]} (relation ${trade.relation})${pct > 0 ? ` · ${pct}% better prices` : ""} · their purse ${trade.gold} gold`);
    tpReasonEl.textContent = trade.reason;
    tpReasonEl.hidden = trade.reason === "";
    // Rebuild the rows only when something changed (the panel refreshes every second; keeps clicks landing).
    const key = JSON.stringify(trade);
    if (key === tradeKey) return;
    tradeKey = key;
    const btn = (label: string, enabled: boolean, title: string, on: () => void) => {
      const b = document.createElement("button");
      b.className = "econ-btn";
      b.textContent = label;
      b.disabled = !enabled;
      b.title = title;
      b.addEventListener("click", () => {
        b.blur();
        on();
      });
      return b;
    };
    tpBodyEl.replaceChildren(
      ...trade.goods.map((g) => {
        const tr = document.createElement("tr");
        const cell = (...kids: (string | HTMLElement)[]) => {
          const td = document.createElement("td");
          td.append(...kids);
          tr.append(td);
        };
        const canBuy = trade.canTrade && g.buyLeft > 0;
        const canSell = trade.canTrade && g.sellLeft > 0;
        cell(TRADE_GOOD_LABEL[g.good]);
        cell(`${g.stock}/${g.cap}`);
        cell(g.buy.toFixed(2));
        cell(
          btn("+1", canBuy, `Buy 1 (${g.buyLeft} more today)`, () => sendTrade(g.good, 1, "buy")),
          btn("+10", canBuy, `Buy 10 (${g.buyLeft} more today)`, () => sendTrade(g.good, 10, "buy"))
        );
        cell(g.sell.toFixed(2));
        cell(
          btn("-1", canSell, `Sell 1 (${g.sellLeft} more today)`, () => sendTrade(g.good, 1, "sell")),
          btn("-10", canSell, `Sell 10 (${g.sellLeft} more today)`, () => sendTrade(g.good, 10, "sell"))
        );
        return tr;
      })
    );
    tpFootEl.textContent = "Prices rise as you buy and fall as you sell the same good on one day. Each trade earns a little relation (up to 6 a day).";
  }
  let questKey = "";
  const questPanelEl = document.getElementById("quest-panel")!;
  const questListEl = document.getElementById("qp-list")!;
  const questEmptyEl = document.getElementById("qp-empty")!;
  const questsBtn = document.getElementById("quests-btn") as HTMLButtonElement;
  const adventureUi=setupAdventureJournal({send:sendMessage,focus:(x,y)=>{
    if(interiorRef.ui?.active())return game.pushEventToast('build','Leave the interior to view the world map.');
    game.fightPeek={x:(x+.5)*game.tileSize,y:(y+.5)*game.tileSize,until:performance.now()+6000};
  }});
  const adventureBeacon=new Graphics();adventureBeacon.zIndex=1e8;worldLayer.addChild(adventureBeacon);
  app.ticker.add(()=>{const m=adventureMapMarker();adventureBeacon.clear();if(!m||interiorRef.ui?.active())return;const x=(m.x+.5)*game.tileSize,y=(m.y+.5)*game.tileSize,r=8+Math.sin(performance.now()/230)*2;adventureBeacon.poly([x,y-r-16,x+r,y-16,x,y+r-16,x-r,y-16]).stroke({width:2,color:0xffe5a3});adventureBeacon.moveTo(x,y-7).lineTo(x,y+4).stroke({width:2,color:0xffe5a3});});
  function questTimeLeft(ticks: number): string {
    if (ticks >= game.questCycleTicks / 2) return `${(ticks / game.questCycleTicks).toFixed(1)} days left`;
    const secs = Math.ceil(ticks / TICK_RATE);
    return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} left`;
  }
  function questMeta(q: QuestSnapshot): string {
    const progress = q.need !== undefined ? ` · slain ${q.progress ?? 0} / ${q.need}` : "";
    return `Reward ${q.reward} gold, relation +${q.relation} · ${q.accepted ? `fail -${q.penalty}` : `ignore -${q.penalty}`}${progress}`;
  }
  function renderQuests() {
    const open = !questPanelEl.hidden;
    if (open) for (const q of game.latestQuests) game.questSeen.add(q.id);
    const unseen = game.latestQuests.some((q) => !q.accepted && !game.questSeen.has(q.id));
    questsBtn.textContent = game.latestQuests.length > 0 ? `Quests (${game.latestQuests.length})` : "Quests";
    questsBtn.classList.toggle("has-new", unseen);
    if (!open) return;
    questEmptyEl.hidden = game.latestQuests.length > 0;
    const key = JSON.stringify(game.latestQuests.map((q) => ({ ...q, ticksLeft: 0 })));
    if (key !== questKey) {
      questKey = key;
      questListEl.replaceChildren(
        ...game.latestQuests.map((q) => {
          const el = document.createElement("div");
          el.className = `qp-quest${q.accepted ? " accepted" : ""}`;
          el.dataset.questId = String(q.id);
          const name = document.createElement("div");
          name.className = "qp-name has-icon";
          // Batch 2 (SPRITES.md #81): new / accepted quest seal; without the file the CSS "!" / tick shows.
          const seal = document.createElement("img");
          seal.className = "ui-ico";
          seal.alt = "";
          seal.src = q.accepted ? "/sprites/ui-questActive.png" : "/sprites/ui-questNew.png";
          seal.onerror = () => {
            seal.remove();
            name.classList.remove("has-icon");
          };
          name.append(seal, q.title);
          const text = document.createElement("div");
          text.className = "qp-text";
          text.textContent = q.text;
          const meta = document.createElement("div");
          meta.className = "qp-meta";
          setIconText(meta, "reward", questMeta(q));
          const time = document.createElement("div");
          time.className = "qp-meta qp-time";
          const btns = document.createElement("div");
          btns.className = "qp-btns";
          const btn = (label: string, title: string, type: "acceptQuest" | "abandonQuest" | "deliverQuest") => {
            const b = document.createElement("button");
            b.className = "econ-btn";
            b.textContent = label;
            b.title = title;
            b.addEventListener("click", () => {
              b.blur();
              sendMessage({ type, questId: q.id });
            });
            return b;
          };
          if (!q.accepted) btns.append(btn("Accept", "Take on this quest", "acceptQuest"));
          else {
            if (q.kind === "deliver") btns.append(btn("Deliver", `Hand over ${q.qty} from your stock (stand near ${q.siteName}'s walls)`, "deliverQuest"));
            btns.append(btn("Abandon", `Give up (relation -${q.penalty})`, "abandonQuest"));
          }
          el.append(name, text, meta, time, btns);
          return el;
        })
      );
    }
    for (const el of Array.from(questListEl.querySelectorAll<HTMLElement>(".qp-quest"))) {
      const q = game.latestQuests.find((o) => String(o.id) === el.dataset.questId);
      const t = el.querySelector(".qp-time");
      if (q && t) t.textContent = `${q.siteName} · ${questTimeLeft(q.ticksLeft)}`;
    }
  }
  function setQuestPanelOpen(open: boolean) {
    questPanelEl.hidden = !open;
    questKey = "";
    renderQuests();
  }
  questsBtn.addEventListener("click", () => {
    questsBtn.blur();
    setQuestPanelOpen(questPanelEl.hidden);
  });
  // ---- Modular building phase 4: the Work tab (job priorities) and the person card (client/src/work.ts) ----
  const workUi = setupWork({ send: (m) => sendMessage(m), button: document.getElementById("work-btn") as HTMLButtonElement });
  const chronicleUi = setupChronicle({ send: (m) => sendMessage(m), pushEventToast: (c, t) => game.pushEventToast(c, t) });
  document.getElementById("qp-close")!.addEventListener("click", () => setQuestPanelOpen(false));
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !questPanelEl.hidden) setQuestPanelOpen(false);
  });
  bpTradeBtn.addEventListener("click", () => {
    bpTradeBtn.blur();
    tradeOpen = !tradeOpen;
    requestBuildingInfo();
  });
  document.getElementById("tp-close")!.addEventListener("click", () => {
    tradeOpen = false;
    tradePanelEl.hidden = true;
  });
  // Tile the panel shows; re-requested every second while open so numbers stay live.
  let infoTile: { tx: number; ty: number } | null = null;
  const BUILDING_INFO_REFRESH_MS = 1000;
  function requestBuildingInfo() {
    if (infoTile) sendMessage({ type: "buildingInfo", tileX: infoTile.tx, tileY: infoTile.ty });
  }
  function openBuildingInfo(tx: number, ty: number) {
    if (infoTile?.tx !== tx || infoTile?.ty !== ty) bpWorkCandsOpen = false;
    infoTile = { tx, ty };
    tradeOpen = false;
    requestBuildingInfo();
  }
  function closeBuildingInfo() {
    infoTile = null;
    buildingPanelEl.hidden = true;
    tradeOpen = false;
    tradePanelEl.hidden = true;
  }
  // Gap closure G3: the building's workers (Unassign) and an "Assign worker" list of free villagers.
  const bpWorkRowEl = document.getElementById("bp-work-row")!;
  const bpWorkListEl = document.getElementById("bp-work-list")!;
  const bpWorkAssignBtn = document.getElementById("bp-work-assign") as HTMLButtonElement;
  const bpWorkCandsEl = document.getElementById("bp-work-cands")!;
  let bpWorkCandsOpen = false;
  let bpWorkSig = "";
  const skillText = (n: number) => (n > 0 ? `skill ${n}` : "no skill needed");
  function workAction(msg: ClientMessage) {
    sendMessage(msg);
    window.setTimeout(requestBuildingInfo, 150);
  }
  bpWorkAssignBtn.addEventListener("click", () => {
    bpWorkAssignBtn.blur();
    bpWorkCandsOpen = !bpWorkCandsOpen;
    bpWorkSig = "";
    requestBuildingInfo();
  });
  function renderWorkPosts(posts: BuildingInfo["posts"]) {
    bpWorkRowEl.hidden = !posts;
    if (!posts || !infoTile) {
      bpWorkCandsOpen = false;
      bpWorkSig = "";
      return;
    }
    // Refreshed once a second: only rebuild on a change (keeps the hovered button).
    const sig = JSON.stringify([posts, bpWorkCandsOpen, infoTile]);
    if (sig === bpWorkSig) return;
    bpWorkSig = sig;
    const { tx, ty } = infoTile;
    const line = (text: string, title: string, btn?: [string, () => void]) => {
      const div = document.createElement("div");
      div.className = "bpw-line";
      const span = document.createElement("span");
      span.textContent = text;
      span.title = title;
      div.append(span);
      if (btn) {
        const b = document.createElement("button");
        b.className = "econ-btn";
        b.textContent = btn[0];
        b.addEventListener("click", btn[1]);
        div.append(b);
      }
      return div;
    };
    bpWorkListEl.replaceChildren(
      ...posts.workers.map((w) =>
        line(
          `${w.pinned ? "⚑ " : ""}${w.name}: ${posts.role}, ${skillText(w.skill)}${w.pinned ? " (assigned)" : ""}`,
          w.pinned ? "Assigned by hand: stays until unassigned or its work type is set off" : "Placed by work priorities (gives way to a hand-assigned worker)",
          ["Unassign", () => workAction({ type: "unassignWorker", id: w.id })]
        )
      ),
      ...(posts.open > 0 ? [line(`${posts.open} open post${posts.open === 1 ? "" : "s"} (${posts.role})`, "Filled by work priorities, or assign someone by hand")] : [])
    );
    bpWorkAssignBtn.disabled = !posts.canAssign || posts.candidates.length === 0;
    bpWorkAssignBtn.title = !posts.canAssign
      ? "Every worker here is assigned by hand: unassign one first"
      : posts.candidates.length === 0
        ? `No free adult villager with ${WORK_LABEL[posts.work]} on`
        : "Pick a free villager: pinned to this post until unassigned (beats work priorities)";
    bpWorkAssignBtn.textContent = bpWorkCandsOpen ? "Assign worker ▴" : "Assign worker ▾";
    bpWorkCandsEl.hidden = !bpWorkCandsOpen || bpWorkAssignBtn.disabled;
    bpWorkCandsEl.replaceChildren(
      ...posts.candidates.map((c) =>
        line(`${c.name}: ${WORK_LABEL[posts.work]} ${skillText(c.skill)} · ${c.job}`, "Free villager", [
          "Assign",
          () => {
            bpWorkCandsOpen = false;
            workAction({ type: "assignWorker", id: c.id, tileX: tx, tileY: ty });
          },
        ])
      )
    );
  }
  function renderBuildingInfo(info: BuildingInfo) {
    bpNameEl.textContent = info.name;
    renderWorkPosts(info.posts);
    bpLevelEl.textContent = info.maxLevel > 1 ? `Lv ${info.level}/${info.maxLevel}` : "";
    bpStaffingEl.textContent = info.staffing;
    bpHpEl.hidden = info.hp === null;
    if (info.hp !== null) bpHpEl.textContent = `HP ${info.hp}/${info.maxHp}`;
    bpConstructionEl.hidden = info.construction === null;
    if (info.construction !== null) {
      const label = info.tile === TileType.ConstructionSite ? "Under construction" : "Upgrading";
      bpConstructionEl.textContent = `${label}: ${Math.round(info.construction * 100)}%`;
    }
    const lines = [...info.bonuses, ...(info.mine?.lines ?? []), ...(info.progression ?? [])];
    const items = lines.length > 0 ? lines : ["None yet"];
    bpBonusesEl.replaceChildren(
      ...items.map((text) => {
        const li = document.createElement("li");
        li.textContent = text;
        return li;
      })
    );
    bpUpgradeRowEl.hidden = info.upgrade === null;
    if (info.upgrade) {
      bpUpgradeBtn.disabled = !info.upgrade.enabled;
      bpUpgradeCostEl.textContent = info.upgrade.reason ? `${info.upgrade.cost} (${info.upgrade.reason})` : info.upgrade.cost;
    }
    const pv = info.upgrade ? info.mine?.preview : undefined;
    mineDigPreview = pv ? { level: pv.level, chance: pv.chance, risk: pv.risk } : null;
    bpMineRiskEl.hidden = !pv;
    if (pv) {
      bpMineRiskEl.dataset.risk = pv.risk;
      const head = document.createElement("div");
      head.className = "risk-head";
      head.textContent = `Digging to level ${pv.level}: nest risk ${MINE_RISK_LABEL[pv.risk]} (${Math.round(pv.chance * 100)}%), ${pv.danger.toLowerCase()} nest`;
      const ul = document.createElement("ul");
      ul.replaceChildren(...pv.lines.map((t) => Object.assign(document.createElement("li"), { textContent: t })));
      bpMineRiskEl.replaceChildren(head, ul);
    }
    const armed = !!mineDigPreview && mineDigPreview.chance > 0 && performance.now() < mineDigArmedUntil;
    bpUpgradeBtn.textContent = armed ? `Confirm: dig to level ${mineDigPreview!.level}` : "Upgrade";
    bpUpgradeBtn.title = mineDigPreview && mineDigPreview.chance > 0 ? "Digging deeper may break into a nest: read the risk below, then click again to confirm" : "";
    bpRepairRowEl.hidden = info.repair === null;
    if (info.repair) {
      bpRepairBtn.disabled = !info.repair.enabled;
      bpRepairCostEl.textContent = info.repair.reason ? `${info.repair.cost} (${info.repair.reason})` : info.repair.cost;
    }
    bpKeepRowEl.hidden = !info.keep;
    if (info.keep) {
      bpKeepBtn.disabled = !info.keep.enabled;
      bpKeepStateEl.textContent = info.keep.reason ? `${info.keep.cost} (${info.keep.reason})` : info.keep.cost;
    }
    renderTradingPost(info.tradingPost);
    renderVassal(info.vassal);
    bpTradeRowEl.hidden = !info.trade;
    if (info.trade) {
      bpTradeBtn.textContent = tradeOpen ? "Close trade" : "Trade";
      setIconText(bpTradeStateEl, info.trade.canTrade ? relIcon(info.trade.tier) : "relation", info.trade.canTrade ? `${RELATION_TIER_NAMES[info.trade.tier]} prices` : info.trade.reason);
    } else tradeOpen = false;
    renderTrade(info.trade);
    renderRoom(info.room);
    bpBlueprintRowEl.style.display = info.blueprint ? "flex" : "none";
    if (info.blueprint) {
      bpPriorityBtn.textContent = info.blueprint.priority ? "Priority: on" : "Priority: off";
      bpPriorityBtn.title = "Builders take priority blueprints first";
      bpCancelBtn.textContent = `Cancel (refund ${info.blueprint.refund})`;
    }
    bpGateRowEl.hidden = !info.gate;
    if (info.gate) {
      shownGateLock = info.gate.lock;
      bpGateBtn.textContent = `Lock: ${GATE_LOCK_LABEL[info.gate.lock]}`;
      bpGateStateEl.textContent = info.gate.overrun ? "Overrun!" : info.gate.open ? "Open" : "Closed";
    }
    bpMineRowEl.hidden = !info.mine || info.mine.status !== "infested";
    if (info.mine) {
      const a = info.mine.assault;
      bpMineBtn.disabled = a.reason !== "";
      bpMineBtn.textContent = `Send soldiers in (${a.soldiers})`;
      bpMineBtn.title = a.reason || "The soldiers near the mine go in and fight the monsters (some may fall)";
      bpMineStateEl.textContent = a.reason || `${info.mine.monsters} monster${info.mine.monsters === 1 ? "" : "s"} inside`;
    }
    bpLevyRowEl.hidden = !info.levy;
    if (info.levy) {
      const l = info.levy;
      shownLevyOnField = l.onField;
      bpLevyBtn.disabled = l.onField === 0 && l.reason !== "";
      bpLevyBtn.textContent = l.onField > 0 ? `Stand down (${l.onField})` : `Call to arms (${l.ready} villagers)`;
      bpLevyBtn.title = l.onField > 0 ? "Send the levy back to work now" : l.reason || "Civilians fight as militia for half a day, then go back to work";
      bpLevyStateEl.textContent = l.onField > 0 ? `${l.onField} levies on the field, ${Math.ceil(l.ticksLeft / 20)} s left` : l.reason || `${l.ready} adult civilians would take up spears`;
    }
    bpTrainRowEl.hidden = !info.train;
    if (info.train) {
      const t = info.train;
      const name = t.kind.replace(/[A-Z]/g, (ch) => " " + ch.toLowerCase());
      bpTrainBtn.disabled = t.reason !== "";
      // Basic militia need no gear: unarmed (weaker, no armour) unless a T1 weapon + armour are in stock.
      const gear = t.gearOptional ? (t.geared ? "takes T1 weapon + armour" : "unarmed: no gear in stock") : `T${t.level} weapon + armour`;
      bpTrainBtn.textContent = `Train ${name} (${gear}, ${t.days} day${t.days === 1 ? "" : "s"})`;
      bpTrainBtn.title =
        t.reason ||
        (t.gearOptional
          ? "Takes one free adult civilian. Basic militia train without gear; with a T1 weapon + armour in stock they take them (unarmed militia hit softer and have no armour)"
          : `Takes one free adult civilian and a T${t.level} weapon + armour`);
      // Batch training: x5 / x10 / Max queue several at once (each a free adult + gear up front); Cancel sends the
      // last-queued trainee home with a refund.
      const max = t.max ?? (t.reason ? 0 : 1);
      for (const [n, b] of game.bpTrainBatchBtns) {
        b.disabled = t.reason !== "" || (n === "max" ? max < 1 : max < n);
        b.textContent = n === "max" ? `Max (${max})` : `x${n}`;
        b.title = t.reason || (n === "max" ? `Train ${max} now (as many as room, free adults and gear allow)` : `Train ${n} at once`);
      }
      game.bpTrainCancelBtn.disabled = t.training === 0;
      const queue = t.queue ?? [];
      const busy = queue.filter((q) => !q.waiting).map((q) => `${q.name} ${Math.round(q.progress * 100)}%`);
      const waiting = t.waiting ?? 0;
      bpTrainStateEl.textContent =
        `Troops ${t.troops}/${t.cap}` +
        (t.training ? ` · ${t.training - waiting} training${t.slots ? ` (${t.slots} at a time)` : ""}${waiting ? `, ${waiting} waiting` : ""}` : "") +
        (busy.length ? ` · ${busy.slice(0, 6).join(", ")}${busy.length > 6 ? ", ..." : ""}` : "") +
        (t.reason ? ` · ${t.reason}` : "");
    }
    bpSiegeRowEl.hidden = !info.siege;
    if (info.siege) {
      for (const opt of info.siege.options) {
        const btn = bpSiegeBtns.get(opt.kind);
        if (!btn) continue;
        btn.disabled = !opt.enabled;
        btn.textContent = `Build ${opt.label} (${opt.cost})`;
        btn.title = opt.reason;
      }
      const reason = info.siege.options.find((o) => !o.enabled)?.reason ?? "";
      bpSiegeStateEl.textContent = info.siege.building
        ? `Building: ${info.siege.building === "batteringRam" ? "Battering Ram" : "Catapult"} ${Math.round((info.siege.progress ?? 0) * 100)}%`
        : `Engines ${info.siege.units}/${info.siege.cap}${reason ? ` · ${reason}` : ""}`;
    }
    bpForgeRowEl.hidden = !info.forge;
    if (info.forge) {
      for (const opt of info.forge.options) {
        const btn = bpForgeBtns.get(opt.slot);
        if (!btn) continue;
        btn.disabled = !opt.enabled;
        btn.textContent = `${opt.label} (${opt.cost})`;
        btn.title = opt.reason;
      }
      const f = info.forge;
      const reason = f.options.find((o) => !o.enabled)?.reason ?? "";
      const head = f.queue[0];
      // A long queue (cap 20) reads as counts per slot / tier: "then Armour T2 x5, Weapon T2 x3".
      const rest = new Map<string, number>();
      for (const q of f.queue.slice(1)) {
        const k = `${q.slot === "armour" ? "Armour" : "Weapon"} T${q.tier}`;
        rest.set(k, (rest.get(k) ?? 0) + 1);
      }
      const then = rest.size > 0 ? ` · then ${Array.from(rest, ([k, n]) => `${k} x${n}`).join(", ")}` : "";
      bpForgeStateEl.textContent = head
        ? `Forging: ${head.slot === "armour" ? "Armour" : "Weapon"} T${head.tier} ${Math.round((f.progress ?? 0) * 100)}% · queue ${f.queue.length}/${f.cap}${then}${reason ? ` · ${reason}` : ""}`
        : `Forges tier ${f.tier} · queue 0/${f.cap}${reason ? ` · ${reason}` : ""}`;
      const auto = f.auto;
      bpForgeAutoBtn.hidden = bpForgeAutoLessBtn.hidden = bpForgeAutoMoreBtn.hidden = bpForgeAutoStateEl.hidden = !auto;
      if (auto) {
        shownForgeAuto = { on: auto.on, target: auto.target };
        bpForgeAutoBtn.textContent = `Autocraft: ${auto.on ? "On" : "Off"}`;
        bpForgeAutoBtn.classList.toggle("active", auto.on);
        bpForgeAutoStateEl.textContent = `Autocraft target ${auto.target} armour + ${auto.target} weapons T${f.tier} (keeps ${auto.reserve} iron / wood)${auto.on ? ` · ${auto.status}` : ""}`;
      }
    }
    bpHeroesRowEl.hidden = !info.heroes;
    if (info.heroes) {
      const h = info.heroes;
      for (const opt of h.options) {
        const btn = bpHeroBtns.get(opt.heroClass);
        if (!btn) continue;
        btn.disabled = !opt.enabled;
        btn.textContent = `Recruit ${opt.label} (${opt.cost})`;
        btn.title = opt.reason;
      }
      const reason = h.options.find((o) => !o.enabled)?.reason ?? "";
      const roster = h.roster.map((r) => `${r.name} (${HERO_CLASS_LABEL[r.heroClass]} Lv ${r.level}) - ${r.status}`).join("\n");
      bpHeroesStateEl.textContent = `Heroes ${h.count}/${h.cap}${reason ? ` · ${reason}` : ""}${roster ? `\n${roster}` : ""}`;
    }
    // Hero phase 4: a Church teaches the two basic spells to the player for colony gold.
    bpSpellsRowEl.hidden = !info.spellShop;
    if (info.spellShop) {
      const key = JSON.stringify(info.spellShop);
      if (key !== bpSpellsKey) {
        bpSpellsKey = key;
        bpSpellsRowEl.replaceChildren(
          ...info.spellShop.map((opt) => {
            const btn = document.createElement("button");
            btn.className = "econ-btn";
            btn.disabled = !opt.enabled;
            btn.textContent = `Learn ${opt.label} (${opt.gold} gold)`;
            btn.title = opt.reason || SPELLS[opt.spellId].text.replace("{power}", String(SPELLS[opt.spellId].power));
            btn.addEventListener("click", () => {
              btn.blur();
              if (!infoTile) return;
              sendMessage({ type: "learnSpell", spellId: opt.spellId, tileX: infoTile.tx, tileY: infoTile.ty });
              window.setTimeout(requestBuildingInfo, 150);
            });
            return btn;
          })
        );
      }
    }
    animalPanel.render(info.animals);
    let stableLinks=document.getElementById('army-stables');
    if(!stableLinks){stableLinks=document.createElement('section');stableLinks.id='army-stables';buildingPanelEl.append(stableLinks);}
    stableLinks.replaceChildren();stableLinks.hidden=info.armyStables===undefined||info.tile===TileType.Stables;
    if(info.armyStables){
      const heading=document.createElement('h4');heading.textContent='Horses & stables';stableLinks.append(heading);
      if(!info.armyStables.length)stableLinks.append('Build Stables to buy and keep riding horses.');
      for(const stable of info.armyStables){const button=document.createElement('button');button.className='cmd-btn';button.textContent=`Buy horses at Stables (${stable.x}, ${stable.y})`;button.onclick=()=>openBuildingInfo(stable.x,stable.y);stableLinks.append(button);}
    }
    buildingPanelEl.hidden = false;
  }
  const animalPanel = createAnimalPanel({ anchor: bpSpellsRowEl, send: (m) => sendMessage(m as never), tile: () => infoTile, refresh: () => requestBuildingInfo() });
  for (const [cls, btn] of bpHeroBtns) {
    btn.addEventListener("click", () => {
      btn.blur();
      if (!infoTile) return;
      sendMessage({ type: "recruitHero", tx: infoTile.tx, ty: infoTile.ty, class: cls });
      window.setTimeout(requestBuildingInfo, 150);
    });
  }
  bpMineBtn.addEventListener("click", () => {
    bpMineBtn.blur();
    if (!infoTile) return;
    sendMessage({ type: "mineAssault", tileX: infoTile.tx, tileY: infoTile.ty });
    window.setTimeout(requestBuildingInfo, 150);
  });
  bpLevyBtn.addEventListener("click", () => {
    bpLevyBtn.blur();
    if (!infoTile) return;
    sendMessage({ type: "callVillagers", tileX: infoTile.tx, tileY: infoTile.ty, ...(shownLevyOnField > 0 ? { dismiss: true } : {}) });
    window.setTimeout(requestBuildingInfo, 150);
  });
  bpTrainBtn.addEventListener("click", () => {
    bpTrainBtn.blur();
    if (!infoTile) return;
    sendMessage({ type: "trainUnit", tileX: infoTile.tx, tileY: infoTile.ty });
    window.setTimeout(requestBuildingInfo, 150);
  });
  for (const [slot, btn] of bpForgeBtns) {
    btn.addEventListener("click", () => {
      btn.blur();
      if (!infoTile) return;
      sendMessage({ type: "queueForge", tileX: infoTile.tx, tileY: infoTile.ty, slot });
      window.setTimeout(requestBuildingInfo, 150);
    });
  }
  const sendForgeAuto = (on: boolean, target: number) => {
    if (!infoTile) return;
    sendMessage({ type: "setForgeAuto", tileX: infoTile.tx, tileY: infoTile.ty, on, target: Math.max(1, Math.min(20, target)) });
    window.setTimeout(requestBuildingInfo, 150);
  };
  bpForgeAutoBtn.addEventListener("click", () => {
    bpForgeAutoBtn.blur();
    sendForgeAuto(!shownForgeAuto.on, shownForgeAuto.target);
  });
  bpForgeAutoLessBtn.addEventListener("click", () => {
    bpForgeAutoLessBtn.blur();
    sendForgeAuto(true, shownForgeAuto.target - 1);
  });
  bpForgeAutoMoreBtn.addEventListener("click", () => {
    bpForgeAutoMoreBtn.blur();
    sendForgeAuto(true, shownForgeAuto.target + 1);
  });
  bpKeepBtn.addEventListener("click", () => {
    bpKeepBtn.blur();
    if (!infoTile) return;
    sendMessage({ type: "rebuildKeep", tileX: infoTile.tx, tileY: infoTile.ty });
    window.setTimeout(requestBuildingInfo, 150);
  });
  bpGateBtn.addEventListener("click", () => {
    bpGateBtn.blur();
    if (!infoTile) return;
    sendMessage({ type: "setGateLock", tileX: infoTile.tx, tileY: infoTile.ty, lock: GATE_LOCK_NEXT[shownGateLock] });
    window.setTimeout(requestBuildingInfo, 150);
  });
  for (const [kind, btn] of bpSiegeBtns) {
    btn.addEventListener("click", () => {
      btn.blur();
      if (!infoTile) return;
      sendMessage({ type: "queueSiege", tileX: infoTile.tx, tileY: infoTile.ty, kind });
      window.setTimeout(requestBuildingInfo, 150);
    });
  }
  bpUpgradeBtn.addEventListener("click", () => {
    bpUpgradeBtn.blur();
    if (!infoTile) return;
    // A mine whose next depth may hold a nest: the first click arms (shows the risk), the second within 6 s digs.
    if (mineDigPreview && mineDigPreview.chance > 0 && performance.now() >= mineDigArmedUntil) {
      mineDigArmedUntil = performance.now() + 6000;
      bpUpgradeBtn.textContent = `Confirm: dig to level ${mineDigPreview.level}`;
      bpMineRiskEl.scrollIntoView({ block: "nearest" });
      window.setTimeout(() => {
        if (performance.now() >= mineDigArmedUntil) bpUpgradeBtn.textContent = "Upgrade";
      }, 6100);
      return;
    }
    mineDigArmedUntil = 0;
    sendMessage({ type: "upgradeBuilding", tileX: infoTile.tx, tileY: infoTile.ty });
    window.setTimeout(requestBuildingInfo, 150);
  });
  bpRepairBtn.addEventListener("click", () => {
    bpRepairBtn.blur();
    if (!infoTile) return;
    sendMessage({ type: "repairBuilding", tileX: infoTile.tx, tileY: infoTile.ty });
    window.setTimeout(requestBuildingInfo, 150);
  });
  document.getElementById("bp-close")!.addEventListener("click", (e) => {
    (e.currentTarget as HTMLButtonElement).blur();
    closeBuildingInfo();
  });
  window.setInterval(() => {
    if (infoTile && !buildingPanelEl.hidden) requestBuildingInfo();
  }, BUILDING_INFO_REFRESH_MS);
  return { requestBuildingInfo, bpTrainBtn, adventureUi, renderQuests, chronicleUi, workUi, renderBuildingInfo, closeBuildingInfo, INFO_TILES, openBuildingInfo, get infoTile() { return infoTile; } };
}
