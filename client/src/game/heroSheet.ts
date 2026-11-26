// Hero sheet (inventory modal): paper doll, pack, armoury, stats, spell book, needs, skills, family tabs,
// item tooltips and the item context menu. Split out of main.ts (2026-11-26).
import { ADVENTURE_GEAR, adventureTrait } from "@colony/shared/expeditions";
import { PLAYER_GEAR_SLOTS, PLAYER_WEAPON_KINDS } from "@colony/shared/protocol";
import { gearIconUrl } from "../heroAppearance";
import { HERO_WEAPON_KINDS } from "@colony/shared/protocol";
import { setupHeroTools } from "../herotools";
import type { PlayerSnapshot, ColonistSnapshot, EquipSlot, EquipmentStock, GearItem, GearSlot, HeroProfileSnapshot, HeroSheetSnapshot, ItemStats } from "@colony/shared/protocol";
import { spellCooldownSeconds, spellcastingCooldownMult, spellcastingEffectMult } from "@colony/shared/herolife";
import { HERO_CLASS_LABEL } from "@colony/shared/protocol";
import { SPELLS, SPELL_SLOT_COUNT } from "@colony/shared/protocol";
import type { SpellId, SpellBookSnapshot } from "@colony/shared/protocol";

// Closure state from main.ts. Plain fields are fixed references (objects mutated in place, functions); the
// readonly / settable ones are live getters (or setters) onto main's `let` variables.
export interface HeroSheetContext {
  sendMessage: (msg: object) => void;
  renderSpellBar: () => void;
  heroToolsRef: { ui: ReturnType<typeof setupHeroTools> | null };
  readonly latestColonists: ColonistSnapshot[];
  readonly selectedIds: Set<string>;
  spellCdAt: number;
}

export function createHeroSheet(game: HeroSheetContext) {
  const { sendMessage, renderSpellBar, heroToolsRef } = game;
  // ---- Hero phases 1-2: Character sheet (` key or the Hero button). The server sends this player's
  // profile in a snapshot only when it changes (snapshot.profile); the sheet re-renders then, or when the
  // colony's armoury stock changes while it's open. Placeholder icons: a coloured square with a slot
  // glyph and a rarity border (bronze / silver / gold / purple-teal relic); a real icon (SPRITES.md #49 /
  // #51, /sprites/<item.icon>.png) is drawn over it once that file exists.
  const heroModal = document.getElementById("hero-modal")!;
  const hsDoll = document.getElementById("hs-doll")!;
  const hsInv = document.getElementById("hs-inv")!;
  const hsStats = document.getElementById("hs-stats")!;
  const hsArmoury = document.getElementById("hs-armoury")!;
  const hsTip = document.getElementById("hs-tip")!;
  let heroProfile: HeroProfileSnapshot | null = null;
  let armouryWeapon: typeof HERO_WEAPON_KINDS[number] = "sword";
  let armouryPart: "head"|"chest"|"offhand" = "chest";
  // Hero phase 3: the colony's heroes (snapshot `heroes`) and the open tab ("" = the player).
  let heroSheets: HeroSheetSnapshot[] = [];
  let sheetTab = "";
  const hsTabs = document.getElementById("hs-tabs")!;
  const hsTitle = document.getElementById("hs-title")!;
  let heroStock: EquipmentStock | undefined;
  let heroRenderKey = "";
  let heroHpText = "";
  let heroMe: PlayerSnapshot | undefined;
  const missingIcons = new Set<string>();
  const SLOT_LABEL: Record<GearSlot, string> = {
    head: "Head", chest: "Chest", legs: "Legs", weapon: "Weapon", offhand: "Off-hand", trinket1: "Trinket", trinket2: "Trinket",
    spell1: "Spell", spell2: "Spell", spell3: "Spell", spell4: "Spell",
  };
  const SLOT_GLYPH: Record<string, string> = {
    head: "H", chest: "C", legs: "L", offhand: "O", trinket: "T", spell: "✶", tome: "▤",
    sword: "⚔", spear: "↑", bow: ")", staff: "|", shield: "O", helm: "H", greaves: "L", cuirass: "C", axe: "⚒", club: "!",
  };
  // Inventory 2026-11-26: the item's own socket kind in the tooltip (not the slot it would go to).
  const KIND_LABEL: Record<string, string> = {
    head: "Head", chest: "Chest", legs: "Legs", weapon: "Weapon", offhand: "Off-hand", trinket: "Trinket", spell: "Spell", tome: "Spell Tome",
  };
  const SLOT_FILL: Record<string, string> = {
    head: "#5b6b7a", chest: "#6b4a2a", legs: "#4f5a3a", weapon: "#7a3a2a", offhand: "#3a4f6b", trinket: "#6b5a2a", spell: "#4a2f6b", tome: "#4a2f6b",
  };
  const STAT_LINES: { key: keyof ItemStats; label: string; pct: boolean; lowerIsBetter?: boolean }[] = [
    { key: "damagePct", label: "damage", pct: true },
    { key: "damageTakenPct", label: "damage taken", pct: true, lowerIsBetter: true },
    { key: "maxHp", label: "max HP", pct: false },
    { key: "moveSpeedPct", label: "move speed", pct: true },
    { key: "attackSpeedPct", label: "attack speed", pct: true },
    { key: "spellPowerPct", label: "spell power", pct: true },
  ];
  const signed = (n: number, pct: boolean) => `${n > 0 ? "+" : ""}${n}${pct ? "%" : ""}`;
  function gearSlotFor(item: GearItem, prof: HeroProfileSnapshot): GearSlot | null {
    if (item.slot === "spell" || item.slot === "tome") return null;
    if (!sheetTab && (!PLAYER_GEAR_SLOTS.includes(item.slot as GearSlot) || (item.slot === "weapon" && !PLAYER_WEAPON_KINDS.includes(item.kind as any)) || (item.slot === "offhand" && item.kind !== "shield"))) return null;
    if (item.slot === "trinket") return prof.equipment.trinket1 && !prof.equipment.trinket2 ? "trinket2" : "trinket1";
    return item.slot;
  }
  function itemIcon(item: GearItem): HTMLElement {
    const el = document.createElement("div");
    el.className = `hs-item ${item.tier === "relic" ? "relic" : `t${item.tier}`}`;
    el.style.background = SLOT_FILL[item.slot] ?? "#555";
    el.textContent = SLOT_GLYPH[item.kind ?? ""] ?? SLOT_GLYPH[item.slot] ?? "?";
    // A Spell Tome shows its spell's current icon (saved tomes may carry an older icon name).
    const generatedIcon = gearIconUrl(item);
    const icon = item.spellId ? SPELLS[item.spellId].icon : generatedIcon ?? item.icon;
    if (icon && !missingIcons.has(icon)) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = generatedIcon ?? `/sprites/${icon}.png`;
      img.onerror = () => {
        missingIcons.add(icon);
        img.remove();
      };
      el.append(img);
    }
    return el;
  }
  function showItemTip(e: MouseEvent, item: GearItem, compare: GearItem | null, hint: string, showDelta: boolean) {
    hsTip.replaceChildren();
    const name = document.createElement("b");
    name.textContent = item.name;
    const tier = document.createElement("div");
    tier.className = "tier";
    const kindText = item.kind && !["helm", "shield", "cuirass", "greaves"].includes(item.kind) ? ` (${item.kind})` : "";
    tier.textContent = `${item.tier === "relic" ? "Relic" : `Tier ${item.tier}`} · ${KIND_LABEL[item.slot] ?? item.slot}${kindText}`;
    hsTip.append(name, tier);
    const trait=adventureTrait(item);if(trait){const d=ADVENTURE_GEAR[trait],line=document.createElement("p");line.textContent=d.benefit+" Tradeoff: "+d.cost;hsTip.append(line);}
    for (const line of STAT_LINES) {
      const v = item.stats[line.key] ?? 0;
      const old = compare?.stats[line.key] ?? 0;
      if (v === 0 && old === 0) continue;
      const row = document.createElement("div");
      row.textContent = `${signed(v, line.pct)} ${line.label}`;
      if (showDelta) {
        const d = v - old;
        if (d !== 0) {
          const span = document.createElement("span");
          const better = line.lowerIsBetter ? d < 0 : d > 0;
          span.className = better ? "up" : "down";
          span.textContent = ` (${signed(d, line.pct)})`;
          row.append(span);
        }
      }
      hsTip.append(row);
    }
    if (!STAT_LINES.some((line) => (item.stats[line.key] ?? 0) !== 0)) {
      const row = document.createElement("div");
      row.textContent = "No stat bonuses";
      hsTip.append(row);
    }
    const foot = document.createElement("div");
    foot.className = "tier";
    foot.textContent = compare ? `${hint} · vs ${compare.name}` : hint;
    hsTip.append(foot);
    hsTip.hidden = false;
    hsTip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - 270)}px`;
    hsTip.style.top = `${Math.min(e.clientY + 14, window.innerHeight - hsTip.offsetHeight - 8)}px`;
  }
  function hideItemTip() {
    hsTip.hidden = true;
  }
  function makeSocket(slot: GearSlot | null, item: GearItem | null, opts: { disabled?: boolean; empty?: string; onClick?: () => void; tip?: (e: MouseEvent) => void }) {
    const el = document.createElement("div");
    el.className = `hs-socket${opts.disabled ? " disabled" : ""}`;
    if (slot) el.dataset.slot = slot;
    if (item) el.append(itemIcon(item));
    else {
      const empty = document.createElement("span");
      empty.className = "hs-empty";
      empty.textContent = opts.empty ?? "";
      el.append(empty);
    }
    if (opts.onClick && !opts.disabled) {
      el.tabIndex = 0;
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", item ? `${item.name} — ${slot ? "unequip" : "equip"}` : opts.empty ?? "Equipment slot");
      el.addEventListener("keydown", e => { if(e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); } });
    }
    if (opts.onClick && !opts.disabled) el.addEventListener("click", () => {
      hideItemTip();
      opts.onClick!();
    });
    if (opts.tip) {
      el.addEventListener("mousemove", opts.tip);
      el.addEventListener("mouseleave", hideItemTip);
      // Keyboard: the tooltip beside the focused socket.
      el.addEventListener("focus", () => {
        const r = el.getBoundingClientRect();
        opts.tip!(new MouseEvent("mousemove", { clientX: r.left, clientY: r.bottom - 8 }));
      });
      el.addEventListener("blur", hideItemTip);
    } else if (opts.disabled) el.title = "Spells: coming soon";
    return el;
  }
  // Inventory 2026-11-26: the Equip / Learn / Drop menu of a pack item (right click, the context-menu key, Shift+F10).
  const invMenu = document.createElement("div");
  invMenu.id = "hs-item-menu";
  invMenu.setAttribute("role", "menu");
  invMenu.hidden = true;
  heroModal.append(invMenu);
  let invMenuFor: HTMLElement | null = null;
  const invNote = document.createElement("div");
  invNote.className = "hs-inv-empty";
  invNote.textContent = "Empty. Relics drop from bosses, mini-bosses and camps; plain gear comes from the armoury.";
  hsInv.after(invNote);
  function closeInvMenu(refocus = true) {
    if (invMenu.hidden) return;
    invMenu.hidden = true;
    invMenu.replaceChildren();
    if (refocus && invMenuFor?.isConnected) invMenuFor.focus();
    invMenuFor = null;
  }
  function openInvMenu(anchor: HTMLElement, item: GearItem, actions: { label: string; run: () => void }[]) {
    hideItemTip();
    invMenu.replaceChildren();
    const title = document.createElement("div");
    title.className = "hs-menu-title";
    title.textContent = item.name;
    invMenu.append(title);
    for (const a of [...actions, { label: "Cancel", run: () => {} }]) {
      const b = document.createElement("button");
      b.setAttribute("role", "menuitem");
      b.textContent = a.label;
      b.addEventListener("click", () => {
        closeInvMenu(a.label === "Cancel");
        a.run();
      });
      invMenu.append(b);
    }
    invMenuFor = anchor;
    invMenu.hidden = false;
    const r = anchor.getBoundingClientRect();
    invMenu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - invMenu.offsetWidth - 8))}px`;
    invMenu.style.top = `${Math.min(r.bottom + 4, window.innerHeight - invMenu.offsetHeight - 8)}px`;
    (invMenu.querySelector("button") as HTMLButtonElement | null)?.focus();
  }
  invMenu.addEventListener("keydown", (e) => {
    const buttons = Array.from(invMenu.querySelectorAll("button"));
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      closeInvMenu();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      buttons[(i + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
    } else if (e.key === "Tab") closeInvMenu(false);
  });
  document.addEventListener("pointerdown", (e) => {
    if (!invMenu.hidden && !invMenu.contains(e.target as Node)) closeInvMenu(false);
  });
  // ---- Hero phase 4: spells on the sheet (icons, tooltips) ----
  const hsSpellbook = document.getElementById("hs-spellbook")!;
  const hsSpellAuto = document.getElementById("hs-spell-auto") as HTMLButtonElement;
  // The spell picked in the spell book, waiting for a slot click.
  let pickedSpell: SpellId | null = null;
  const TARGETING_LABEL = { enemy: "Target an enemy", ally: "Target an ally (or yourself)", ground: "Target a spot", self: "Self" };
  // Placeholder: a coloured square with the spell's glyph; /sprites/<icon>.png (SPRITES.md #57) over it once it exists.
  function spellIcon(id: SpellId): HTMLElement {
    const def = SPELLS[id];
    const el = document.createElement("div");
    el.className = "hs-item spell";
    el.style.background = def.color;
    el.textContent = def.glyph;
    if (!missingIcons.has(def.icon)) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = `/sprites/${def.icon}.png`;
      img.onerror = () => {
        missingIcons.add(def.icon);
        img.remove();
      };
      el.append(img);
    }
    return el;
  }
  function spellText(id: SpellId, spellPower: number): string {
    const def = SPELLS[id];
    // Durations / radii in the text stay the table's; the Spellcasting line in the tooltip gives the bonus.
    const n = (v: number) => String(Math.round(v * spellPower * 10) / 10);
    return def.text.replace("{power}", n(def.power)).replace("{burn}", n(def.burnPerSec ?? 0));
  }
  function showSpellTip(e: MouseEvent, id: SpellId, spellPower: number, hint: string, castLevel = 1) {
    const def = SPELLS[id];
    const fx = spellcastingEffectMult(castLevel);
    const cdSec = Math.round(spellCooldownSeconds(id, castLevel) * 10) / 10;
    hsTip.replaceChildren();
    const name = document.createElement("b");
    name.textContent = def.name;
    const meta = document.createElement("div");
    meta.className = "tier";
    meta.textContent = `${TARGETING_LABEL[def.targeting]} · range ${def.range} tiles · cooldown ${cdSec} s`;
    const body = document.createElement("div");
    const power = spellPower * fx;
    body.textContent = spellText(id, power) + (def.power > 0 && Math.abs(power - 1) > 1e-6 ? ` (spell power x${power.toFixed(2)})` : "");
    const skill = document.createElement("div");
    skill.className = "tier";
    skill.textContent = castLevel > 1
      ? `Spellcasting L${castLevel}: +${Math.round((fx - 1) * 100)}% effect, duration and radius; cooldown ${cdSec} s (base ${spellCooldownSeconds(id, 1)} s)`
      : "Spellcasting L1: cast spells to train it (+8% effect, -5% cooldown per level)";
    const foot = document.createElement("div");
    foot.className = "tier";
    foot.textContent = hint;
    hsTip.append(name, meta, body, skill, foot);
    hsTip.hidden = false;
    hsTip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - 270)}px`;
    hsTip.style.top = `${Math.min(e.clientY + 14, window.innerHeight - hsTip.offsetHeight - 8)}px`;
  }
  function renderHeroSheet(force = false) {
    if (heroModal.hidden || !heroProfile) return;
    // Hero phase 3: a hero tab shows that hero's sockets / stats / level over the player's shared pack.
    const hero = sheetTab ? heroSheets.find((h) => h.id === sheetTab) : undefined;
    if (sheetTab && !hero) sheetTab = "";
    const pack = heroProfile;
    const prof: HeroProfileSnapshot = hero ? { ...hero.profile, inventory: pack.inventory, inventoryCap: pack.inventoryCap } : pack;
    const heroArg = hero ? { heroId: hero.id } : {};
    const me = heroMe;
    const unit = hero ? game.latestColonists.find((c) => c.id === hero.id) : undefined;
    const hpText = hero
      ? unit ? `${Math.ceil(unit.hp)} / ${unit.maxHp}` : hero.status === "recruiting" ? `${prof.stats.maxHp} (arriving)` : `fallen: back at dawn / dusk for ${hero.respawnFee} gold`
      : me ? `${Math.ceil(me.hp)} / ${me.maxHp}` : `${prof.stats.maxHp}`;
    const key = JSON.stringify([{ ...prof, spells: prof.spells ? { ...prof.spells, cooldowns: {} } : undefined }, heroStock, sheetTab, !!heroMe?.mounted, pickedSpell, heroSheets.map((h) => [h.id, h.name, h.status, h.profile.level])]);
    if (!force && key === heroRenderKey) {
      if (hpText !== heroHpText) {
        heroHpText = hpText;
        const hpEl = document.getElementById("hs-hp");
        if (hpEl) hpEl.textContent = hpText;
      }
      return;
    }
    heroRenderKey = key;
    heroHpText = hpText;
    hideItemTip();
    hsTitle.textContent = hero ? `${hero.name} · ${HERO_CLASS_LABEL[hero.heroClass]}` : (prof.appearance?.name ?? "Character")+(prof.title?" · "+prof.title:"");
    document.getElementById("hero-appearance")!.hidden = true;
    hsTabs.replaceChildren();
    if (heroSheets.length > 0) {
      const tab = (id: string, label: string, cls = "") => {
        const b = document.createElement("button");
        b.textContent = label;
        b.className = `${id === sheetTab ? "active" : ""} ${cls}`.trim();
        b.addEventListener("click", () => {
          sheetTab = id;
          renderHeroSheet(true);
        });
        hsTabs.append(b);
      };
      tab("", "Player");
      for (const h of heroSheets.slice(0, 9)) tab(h.id, `${h.name} Lv ${h.profile.level}`, h.status === "alive" ? "" : "fallen");
    }
    // Paper-doll: trinket / head / trinket, weapon / chest / off-hand, - / legs / -, then 4 spell slots.
    const layout: (GearSlot | null)[] = hero ? ["trinket1", "head", "trinket2", "weapon", "chest", "offhand", null, "legs", null] : ["head", "chest", "weapon", "offhand", "legs"];
    hsDoll.classList.toggle("player-gear", !hero);
    hsDoll.replaceChildren();
    const stand=document.createElement('img');stand.src='/sprites/hero-hud/armour-stand.png';stand.className='armour-stand';stand.alt='Armour stand';hsDoll.append(stand);
    for (const slot of layout) {
      if (!slot) {
        hsDoll.append(document.createElement("div"));
        continue;
      }
      const item = prof.equipment[slot];
      const gearSocket = makeSocket(slot, item, {
          empty: SLOT_LABEL[slot],
          onClick: item ? () => sendMessage({ type: "unequipItem", slot, ...heroArg }) : undefined,
          tip: item ? (e) => showItemTip(e, item, null, "Click to unequip", false) : undefined,
        });
      gearSocket.dataset.slot=slot;
      gearSocket.setAttribute('role','button');gearSocket.tabIndex=0;
      gearSocket.setAttribute('aria-label',`${SLOT_LABEL[slot]}: ${item?.name ?? 'empty'}`);
      hsDoll.append(gearSocket);
    }
    // Hero phase 4: the 4 spell slots. With a spell picked in the spell book below, a click puts it in the
    // slot; otherwise a click on a filled slot empties it.
    const book: SpellBookSnapshot = prof.spells ?? { learned: [], slots: [null, null, null, null], auto: false, cooldowns: {} };
    const spells = document.createElement("div");
    spells.className = "hs-spells";
    for (let i = 0; i < SPELL_SLOT_COUNT; i++) {
      const id = book.slots[i] ?? null;
      const el = document.createElement("div");
      el.className = `hs-socket${pickedSpell ? " target" : ""}`;
      el.setAttribute('role','button');el.tabIndex=0;el.setAttribute('aria-label',`Spell slot ${i+1}${id?': '+SPELLS[id].name:''}`);
      el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click();}});
      if (id) el.append(spellIcon(id));
      else {
        const empty = document.createElement("span");
        empty.className = "hs-empty";
        empty.textContent = `Spell ${i + 1}`;
        el.append(empty);
      }
      el.addEventListener("click", () => {
        hideItemTip();
        if (pickedSpell) {
          sendMessage({ type: "setSpellSlot", slot: i, spellId: pickedSpell, ...heroArg });
          pickedSpell = null;
        } else if (id) sendMessage({ type: "setSpellSlot", slot: i, spellId: null, ...heroArg });
      });
      el.addEventListener("mousemove", (e) => (id ? showSpellTip(e, id, prof.stats.spellPowerMult, pickedSpell ? `Click to put ${SPELLS[pickedSpell].name} here` : "Click to empty the slot", prof.spells?.castLevel) : pickedSpell ? showSpellTip(e, pickedSpell, prof.stats.spellPowerMult, `Click to put it in slot ${i + 1}`, prof.spells?.castLevel) : hideItemTip()));
      el.addEventListener("mouseleave", hideItemTip);
      spells.append(el);
    }
    document.getElementById("hs-spell-slots")!.replaceChildren(spells);

    // Level / XP.
    document.getElementById("hs-level")!.textContent = String(prof.level);
    const span = prof.nextLevelXp === null ? 1 : prof.nextLevelXp - prof.levelXp;
    const into = prof.nextLevelXp === null ? 1 : prof.xp - prof.levelXp;
    (document.getElementById("hs-xpfill") as HTMLElement).style.width = `${Math.round(Math.min(1, into / span) * 100)}%`;
    document.getElementById("hs-xptext")!.textContent =
      prof.nextLevelXp === null ? `${prof.xp} XP · max level` : `${prof.xp} / ${prof.nextLevelXp} XP · +4% damage and +6${hero ? "%" : ""} HP per level`;

    // Stat summary (multipliers include gear and level).
    const s = prof.stats;
    const mult = (v: number, lowerIsBetter = false) => {
      const el = document.createElement("span");
      el.textContent = `x${v.toFixed(2)}`;
      if (Math.abs(v - 1) > 1e-6) el.className = (lowerIsBetter ? v < 1 : v > 1) ? "up" : "down";
      return el;
    };
    const rows: [string, HTMLElement | string][] = [
      ["Health", hpText],
      ["Damage", mult(s.damageMult)],
      ["Damage taken", mult(s.damageTakenMult, true)],
      ["Move speed", mult(s.moveSpeedMult)],
      ["Attack speed", mult(s.attackSpeedMult)],
      ["Spell power", mult(s.spellPowerMult)],
      ["Spellcasting", castText(prof.spells?.castLevel ?? 1)],
    ];
    function castText(lv: number): HTMLElement {
      const el = document.createElement("span");
      el.textContent = lv > 1 ? `L${lv} (+${Math.round((spellcastingEffectMult(lv) - 1) * 100)}% effect, -${Math.round((1 - spellcastingCooldownMult(lv)) * 100)}% cooldown)` : "L1";
      if (lv > 1) el.className = "up";
      return el;
    }
    hsStats.replaceChildren();
    for (const [label, value] of rows) {
      const l = document.createElement("span");
      l.textContent = label;
      const v = typeof value === "string" ? document.createElement("span") : value;
      if (typeof value === "string") {
        v.id = "hs-hp";
        v.textContent = value;
      }
      hsStats.append(l, v);
    }

    // Hero phase 4: the spell book (learned spells; click one, then a slot) and a hero's Auto toggle.
    hsSpellbook.replaceChildren();
    if (book.learned.length === 0) {
      const empty = document.createElement("div");
      empty.className = "hs-inv-empty";
      empty.textContent = "No spells yet: one every 2 levels, Spell Tomes from bosses and camps, Heal / Ward at a Church.";
      hsSpellbook.append(empty);
    }
    for (const id of book.learned) {
      const el = document.createElement("div");
      el.className = `hs-socket${pickedSpell === id ? " picked" : ""}`;
      el.setAttribute('role','button');el.tabIndex=0;el.setAttribute('aria-label',`Select ${SPELLS[id].name}`);
      el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click();}});
      el.append(spellIcon(id));
      el.addEventListener("click", () => {
        hideItemTip();
        pickedSpell = pickedSpell === id ? null : id;
        renderHeroSheet(true);
      });
      el.addEventListener("mousemove", (e) => showSpellTip(e, id, prof.stats.spellPowerMult, pickedSpell === id ? "Now click a spell slot (click again to cancel)" : "Click, then click a spell slot", prof.spells?.castLevel));
      el.addEventListener("mouseleave", hideItemTip);
      hsSpellbook.append(el);
    }
    hsSpellAuto.hidden = !hero;
    if (hero) {
      hsSpellAuto.textContent = `Auto-cast: ${book.auto ? "On" : "Off"}`;
      hsSpellAuto.classList.toggle("on", book.auto);
      hsSpellAuto.onclick = () => sendMessage({ type: "setSpellAuto", heroId: hero.id, auto: !book.auto });
    }

    // Pack: a fixed grid of inventoryCap slots (Inventory 2026-11-26). Click / Enter equips (or learns a tome); right
    // click, the context-menu key or Shift+F10 opens Equip / Learn / Drop; Delete drops.
    closeInvMenu(false);
    document.getElementById("hs-invcount")!.textContent = `(${prof.inventory.length}/${prof.inventoryCap})`;
    hsInv.replaceChildren();
    hsInv.setAttribute("aria-label", `Pack: ${prof.inventory.length} of ${prof.inventoryCap} slots used`);
    const dropItem = (item: GearItem) => sendMessage({ type: "dropGear", itemId: item.id });
    const withMenu = (sock: HTMLElement, item: GearItem, actions: { label: string; run: () => void }[]) => {
      if (sock.tabIndex < 0) {
        sock.tabIndex = 0;
        sock.setAttribute("role", "button");
        sock.setAttribute("aria-label", `${item.name}: open the item menu`);
      }
      sock.setAttribute("aria-haspopup", "menu");
      const all = [...actions, { label: hero ? "Drop (from your pack)" : "Drop on the ground", run: () => dropItem(item) }];
      sock.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        openInvMenu(sock, item, all);
      });
      sock.addEventListener("keydown", (e) => {
        if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
          e.preventDefault();
          openInvMenu(sock, item, all);
        } else if (e.key === "Delete") {
          e.preventDefault();
          dropItem(item);
        } else if ((e.key === "Enter" || e.key === " ") && !actions.length) {
          e.preventDefault();
          openInvMenu(sock, item, all);
        }
      });
      if (!actions.length) sock.addEventListener("click", () => openInvMenu(sock, item, all));
      return sock;
    };
    for (const item of prof.inventory) {
      // Hero phase 4: a Spell Tome is read ("Learn") by whoever's tab is open, and consumed.
      if (item.slot === "tome" && item.spellId) {
        const spellId = item.spellId;
        const known = book.learned.includes(spellId);
        const learn = () => sendMessage({ type: "useTome", itemId: item.id, ...heroArg });
        hsInv.append(withMenu(
          makeSocket(null, item, {
            onClick: known ? undefined : learn,
            tip: (e) => showSpellTip(e, spellId, prof.stats.spellPowerMult, known ? `${item.name}: already known${hero ? ` by ${hero.name}` : ""} · right click: drop` : `${item.name}: click to Learn${hero ? ` (${hero.name})` : ""} · right click: drop`, prof.spells?.castLevel),
          }),
          item, known ? [] : [{ label: "Learn", run: learn }],
        ));
        continue;
      }
      const target = gearSlotFor(item, prof);
      const current = target ? prof.equipment[target] : null;
      const equip = target ? () => sendMessage({ type: "equipItem", itemId: item.id, slot: target, ...heroArg }) : undefined;
      hsInv.append(withMenu(
        makeSocket(null, item, {
          onClick: equip,
          tip: (e) => showItemTip(e, item, current, `${target ? `Click / Enter: equip (${SLOT_LABEL[target]})` : "Can't be worn here"} · right click: drop`, !!target),
        }),
        item, equip ? [{ label: `Equip (${SLOT_LABEL[target!]})`, run: equip }] : [],
      ));
    }
    for (let i = prof.inventory.length; i < prof.inventoryCap; i++) {
      const empty = document.createElement("div");
      empty.className = "hs-socket hs-slot-empty";
      empty.setAttribute("aria-hidden", "true");
      hsInv.append(empty);
    }
    invNote.hidden = prof.inventory.length > 0;

    // Take from the armoury: one plain piece of a tier out of the colony stock (armour -> chest, weapon -> weapon).
    hsArmoury.replaceChildren();
    const weaponLabel=document.createElement("label"); weaponLabel.className="weapon-choice"; weaponLabel.textContent="Weapon to withdraw";
    const weaponSelect=document.createElement("select"); weaponSelect.setAttribute("aria-label","Armoury weapon");
    for(const kind of (hero ? HERO_WEAPON_KINDS : PLAYER_WEAPON_KINDS)) { const opt=document.createElement("option");opt.value=kind;opt.textContent=kind[0].toUpperCase()+kind.slice(1);weaponSelect.append(opt); }
    if(!hero && !PLAYER_WEAPON_KINDS.includes(armouryWeapon as any)) armouryWeapon="sword";
    weaponSelect.value=armouryWeapon; weaponSelect.onchange=()=>{armouryWeapon=weaponSelect.value as typeof armouryWeapon;renderHeroSheet(true);};
    weaponLabel.append(weaponSelect);hsArmoury.append(weaponLabel);
    const partLabel=document.createElement("label");partLabel.className="weapon-choice";partLabel.textContent="Armour to withdraw";
    const partSelect=document.createElement("select");partSelect.setAttribute("aria-label","Armoury armour slot");
    for(const [value,label] of [["head","Helmet"],["chest","Body armour"],["offhand","Shield"]]){const option=document.createElement("option");option.value=value;option.textContent=label;partSelect.append(option);}
    partSelect.value=armouryPart;partSelect.onchange=()=>{armouryPart=partSelect.value as typeof armouryPart;renderHeroSheet(true);};partLabel.append(partSelect);hsArmoury.append(partLabel);
    const full = prof.inventory.length >= prof.inventoryCap;
    for (const slot of ["armour", "weapon"] as EquipSlot[]) {
      for (let tier = 1; tier <= 3; tier++) {
        const n = heroStock?.[slot][tier - 1] ?? 0;
        const btn = document.createElement("button");
        btn.textContent = `${slot === "armour" ? armouryPart === "head" ? "Helmet" : armouryPart === "offhand" ? "Shield" : "Body armour" : "Weapon"} T${tier} (${n})`;
        btn.disabled = n <= 0 || full;
        btn.title = full ? "Your pack is full" : n <= 0 ? "None in the colony's stock (forge at a Blacksmith)" : "Takes it from the stock soldiers muster with";
        btn.addEventListener("click", () => sendMessage({ type: "takeFromArmoury", slot, tier, ...(slot === "weapon" ? {weaponKind:armouryWeapon} : {armourPart:armouryPart}), ...heroArg }));
        hsArmoury.append(btn);
      }
    }
  }
  function setHeroSheetOpen(open: boolean) {
    // Hero phase 3: opening with exactly one hero selected shows that hero's tab.
    if (open && game.selectedIds.size === 1) {
      const id = [...game.selectedIds][0];
      if (heroSheets.some((h) => h.id === id)) sheetTab = id;
    }
    heroModal.hidden = !open;
    hideItemTip();
    if (open) renderHeroSheet(true);
  }
  document.getElementById("hero-btn")!.addEventListener("click", (e) => {
    (e.currentTarget as HTMLButtonElement).blur();
    setHeroSheetOpen(heroModal.hidden);
  });
  document.getElementById("hs-close")!.addEventListener("click", () => setHeroSheetOpen(false));
  heroModal.addEventListener("click", (e) => {
    if (e.target === heroModal) setHeroSheetOpen(false);
  });
  // ` (Backquote; C is the Church tool) toggles the sheet, Escape closes it.
  window.addEventListener("keydown", (e) => {
    if (e.code === "Backquote" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat) {
      e.preventDefault();
      setHeroSheetOpen(heroModal.hidden);
    } else if (e.key === "Escape" && !heroModal.hidden) {
      setHeroSheetOpen(false);
    }
  });
  function syncHeroProfile(
    profile: HeroProfileSnapshot | undefined, stock: EquipmentStock | undefined, me: PlayerSnapshot | undefined, heroes?: HeroSheetSnapshot[]
  ) {
    if (profile) { heroProfile = profile; heroToolsRef.ui?.refreshWeapons(); }
    // Hero phase 4: cooldown ticks are as of this snapshot; the spell bar counts down from here.
    if (profile?.spells) game.spellCdAt = performance.now();
    if (heroes) heroSheets = heroes;
    heroMe = me;
    heroStock = stock;
    renderHeroSheet();
    renderSpellBar();
  }
  return { spellIcon, showSpellTip, hideItemTip, syncHeroProfile, setHeroSheetOpen, heroModal, itemIcon, get heroProfile() { return heroProfile; } };
}
