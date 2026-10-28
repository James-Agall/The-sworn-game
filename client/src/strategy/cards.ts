// Strategy mode phase 2 (docs PLAN-strategy-mode.md §1 "card bar"): one card per player regiment along the
// bottom of the screen (strategy mode only; the CSS hides it otherwise). Role tabs filter it; click = select
// that regiment (Shift adds / removes), double-click = also centre the camera on it. main.ts builds the card
// models from the server's armyRegiments + live colonist HP; this module only owns the DOM.
import type { CombatRole } from "../protocol";

export type CardTab = "all" | "melee" | "ranged" | "cavalry" | "siege" | "heroes";
const TABS: { key: CardTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "melee", label: "Melee" },
  { key: "ranged", label: "Ranged" },
  { key: "cavalry", label: "Cavalry" },
  { key: "siege", label: "Siege" },
  { key: "heroes", label: "Heroes" },
];
const TAB_ROLES: Record<Exclude<CardTab, "all" | "heroes">, CombatRole[]> = {
  melee: ["frontline", "shock"],
  ranged: ["ranged", "caster"],
  cavalry: ["fast"],
  siege: ["siege"],
};

export interface RegimentCard {
  id: string;
  name: string;
  // Unit sprite URL for the icon.
  icon: string;
  count: number;
  maxCount: number;
  hpFrac: number;
  role?: CombatRole;
  roleLabel: string;
  // CSS colour of the role.
  roleColor: string;
  hero: boolean;
  // Task force (control group) slot badge.
  slot?: number;
  // Stance icon name when every member shares one.
  stance?: string;
  // Strategy mode phase 3: the current order ("Hold", "Move +2"), when the whole regiment shares one.
  order?: string;
  // Strategy mode phase 4: settings shared by every member ("HF", "Sk", "Cyc", a non-line shape).
  flags?: string;
  selected: boolean;
}

interface CardEl {
  el: HTMLButtonElement;
  sig: string;
}

export class RegimentCardBar {
  private tab: CardTab = "all";
  private last: RegimentCard[] = [];
  private els = new Map<string, CardEl>();
  private order = "";
  private readonly tabsEl = document.createElement("div");
  private readonly listEl = document.createElement("div");

  constructor(
    root: HTMLElement,
    private readonly handlers: { select(id: string, additive: boolean): void; centre(id: string): void }
  ) {
    this.tabsEl.className = "reg-tabs";
    this.listEl.className = "reg-list";
    for (const t of TABS) {
      const b = document.createElement("button");
      b.className = "reg-tab";
      b.dataset.tab = t.key;
      b.textContent = t.label;
      b.classList.toggle("active", t.key === this.tab);
      this.tabsEl.appendChild(b);
    }
    root.replaceChildren(this.tabsEl, this.listEl);
    // Keep clicks on the bar from starting a map selection drag.
    root.addEventListener("pointerdown", (e) => e.stopPropagation());
    root.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const tab = target.closest<HTMLElement>(".reg-tab")?.dataset.tab as CardTab | undefined;
      if (tab) {
        this.tab = tab;
        for (const b of Array.from(this.tabsEl.children)) (b as HTMLElement).classList.toggle("active", (b as HTMLElement).dataset.tab === tab);
        this.render(this.last);
        return;
      }
      const id = target.closest<HTMLElement>(".reg-card")?.dataset.id;
      if (id) this.handlers.select(id, e.shiftKey);
    });
    root.addEventListener("dblclick", (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>(".reg-card")?.dataset.id;
      if (id) this.handlers.centre(id);
    });
  }

  private shows(c: RegimentCard): boolean {
    if (this.tab === "all") return true;
    if (this.tab === "heroes") return c.hero;
    return !c.hero && !!c.role && TAB_ROLES[this.tab].includes(c.role);
  }

  render(cards: RegimentCard[]) {
    this.last = cards;
    const shown = cards.filter((c) => this.shows(c));
    const seen = new Set<string>();
    for (const c of shown) {
      seen.add(c.id);
      let ce = this.els.get(c.id);
      if (!ce) {
        const el = document.createElement("button");
        el.className = "reg-card";
        el.dataset.id = c.id;
        ce = { el, sig: "" };
        this.els.set(c.id, ce);
      }
      const hp = Math.round(c.hpFrac * 100);
      const sig = [c.name, c.icon, c.count, c.maxCount, hp, c.roleLabel, c.slot ?? "", c.stance ?? "", c.order ?? "", c.flags ?? "", c.selected].join("|");
      if (sig === ce.sig) continue;
      ce.sig = sig;
      const el = ce.el;
      el.classList.toggle("selected", c.selected);
      el.classList.toggle("empty", c.count === 0);
      el.title = `${c.name}: ${c.count}/${c.maxCount}, ${hp}% health. Click to select, double-click to centre`;
      const hpColor = c.hpFrac > 0.6 ? "#3bd16f" : c.hpFrac > 0.3 ? "#e2b23a" : "#d0452f";
      el.innerHTML =
        (c.slot ? `<span class="reg-slot">${c.slot}</span>` : "") +
        `<img class="reg-icon" src="${c.icon}" alt="" />` +
        (c.stance ? `<img class="reg-stance" src="/sprites/icon-stance-${c.stance}.png" alt="" />` : "") +
        `<span class="reg-name"></span>` +
        `<span class="reg-meta"><span class="reg-count">${c.count}/${c.maxCount}</span><span class="reg-role" style="color:${c.roleColor}">${c.roleLabel}</span>${c.order ? `<span class="reg-order">${c.order}</span>` : ""}${c.flags ? `<span class="reg-flags">${c.flags}</span>` : ""}</span>` +
        `<span class="reg-hp"><span style="width:${hp}%;background:${hpColor}"></span></span>`;
      // Names (hero names, later renames) go in as text, never as markup.
      el.querySelector(".reg-name")!.textContent = c.name;
    }
    for (const [id, ce] of this.els) {
      if (seen.has(id)) continue;
      ce.el.remove();
      this.els.delete(id);
    }
    const order = shown.map((c) => c.id).join(",");
    if (order !== this.order) {
      this.order = order;
      this.listEl.replaceChildren(...shown.map((c) => this.els.get(c.id)!.el));
    }
  }
}
