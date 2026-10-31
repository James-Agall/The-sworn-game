// creative.ts: the Creative mode panel (QUEUE.md "CREATIVE MODE"). A "Creative" top-bar button (creative worlds
// only) opens a parchment panel: Spawn (Yours / Enemies / Neutrals / Armies), World (time, day, raids, sites,
// relations, quests) and Tools (godmode, heal, clear, allow attacking neutrals), plus a short help list. Every
// action is a creativeSpawn / creativeSet message; the server answers with creativeResult (toasted). Compact and
// robust rather than pretty.
import { HUNGER_MARK_NAMES, MOB_ROLE, WILDLIFE_KINDS, WILDLIFE_SNAPSHOT_STRIDE, type ColonistSnapshot } from "@colony/shared/protocol";

export interface CreativeDeps {
  send(msg: object): void;
  // World px at the camera centre.
  centre(): { x: number; y: number };
  toast(ok: boolean, text: string): void;
  selectedIds(): string[];
}

const OWN_KINDS = ["knight", "archer", "militia", "spearman", "pikeman", "cavalry", "batteringRam", "catapult", "hero:champion", "hero:marksman", "hero:mage"];
const WORKERS = ["lumberjack", "farmer", "builder", "ironMiner", "rockMiner", "hunter", "forager", "wagon"];
const FOLK = ["townGuard", "townArcher", "townKnight", "townFarmer", "townMiner", "townPriest"];
const ENEMY_KINDS = Object.keys(MOB_ROLE).filter((k) => !k.startsWith("town"));
const FACTIONS = ["greenskinWarband", "banditBand", "darkHost", "wolfPack", "riderPack"];
const TEMPLATES = ["thornwick", "grakkar", "hearthmoor", "ironhold", "riverwatch"];
const COUNTS = [1, 10, 100, 1000];
const ARMY_SIZES = [10, 50, 100, 500, 1000];

const HELP = [
  "Spawn: pick a kind, a count and a formation; At centre = camera centre, At click = your next left-click on the map.",
  "Neutrals: Test clan units and settlement folk stand still (Dummy) or fight back when hit (Aggressive).",
  "Ctrl+right-click a neutral unit with soldiers selected: force-attack it (works with the toggle off).",
  "Tools > Allow attacking neutrals: clans become hostile; your units attack Test clan units on their own.",
  "World actions on a site use the settlement / fort nearest the spawn point.",
  "Tab: Command view (free camera). Stock is infinite, building is instant, no population caps.",
  "Creative games save only to the Creative slot.",
];

const CSS = `
#creative-panel { position: fixed; top: 52px; right: 12px; z-index: 60; width: 340px; max-height: calc(100vh - 80px); overflow-y: auto;
  background: #ead9b0; color: #3b2a14; border: 2px solid #7a5a2a; border-radius: 6px; box-shadow: 0 4px 18px rgba(0,0,0,.45);
  font: 13px/1.35 Georgia, serif; padding: 8px 10px; }
#creative-panel[hidden] { display: none; }
#creative-panel h3 { margin: 2px 0 6px; font-size: 15px; display: flex; justify-content: space-between; }
#creative-panel .cr-tabs { display: flex; gap: 3px; flex-wrap: wrap; margin-bottom: 6px; }
#creative-panel button { font: inherit; background: #d8c08a; color: #3b2a14; border: 1px solid #7a5a2a; border-radius: 4px; padding: 2px 7px; cursor: pointer; }
#creative-panel button:hover { background: #e9d39f; }
#creative-panel button.on { background: #7a5a2a; color: #f6ecd2; }
#creative-panel select, #creative-panel input { font: inherit; background: #f6ecd2; color: #3b2a14; border: 1px solid #7a5a2a; border-radius: 3px; }
#creative-panel input[type=number] { width: 60px; }
#creative-panel .cr-row { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; margin: 4px 0; }
#creative-panel .cr-row > span:first-child { min-width: 64px; font-weight: bold; }
#creative-panel .cr-sec { border-top: 1px solid #b89a62; margin-top: 6px; padding-top: 4px; }
#creative-panel ul { margin: 4px 0 0 16px; padding: 0; font-size: 12px; }
`;

export function setupCreative(deps: CreativeDeps) {
  let on = false;
  let allowAttack = false;
  let godmode = false;
  let atClick = false;
  // A spawn / stamp waiting for the next map click (At click).
  let pending: ((x: number, y: number) => void) | null = null;
  let lastNeutral: object | null = null;
  let wildlifeFlat: number[] = [];

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);
  const btn = document.createElement("button");
  btn.id = "creative-btn";
  btn.className = "control-btn";
  btn.textContent = "Creative";
  btn.title = "Creative mode: spawn units, set the world, test tools";
  btn.hidden = true;
  const bar = document.getElementById("control-buttons");
  bar?.insertBefore(btn, document.getElementById("hero-btn"));
  const panel = document.createElement("div");
  panel.id = "creative-panel";
  panel.hidden = true;
  document.body.append(panel);
  // Keys typed into the panel (numbers) must not reach the game's hotkeys.
  panel.addEventListener("keydown", (e) => e.stopPropagation());
  btn.addEventListener("click", () => {
    btn.blur();
    panel.hidden = !panel.hidden;
  });

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = "", attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    if (text) e.textContent = text;
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  const button = (text: string, onClick: () => void) => {
    const b = el("button", text, { type: "button" });
    b.addEventListener("click", () => {
      b.blur();
      onClick();
    });
    return b;
  };
  const select = (options: string[], labels?: (o: string) => string) => {
    const s = el("select");
    for (const o of options) s.append(el("option", labels ? labels(o) : o, { value: o }));
    return s;
  };
  const row = (label: string, ...items: HTMLElement[]) => {
    const r = el("div", "", { class: "cr-row" });
    r.append(el("span", label), ...items);
    return r;
  };
  // A segmented choice; returns a getter.
  const seg = (values: number[], initial: number, container: HTMLElement) => {
    let value = initial;
    const btns = values.map((v) => {
      const b = button(String(v), () => {
        value = v;
        btns.forEach((o, i) => o.classList.toggle("on", values[i] === v));
      });
      b.classList.toggle("on", v === initial);
      return b;
    });
    container.append(...btns);
    return () => value;
  };

  // Where an action happens: the camera centre now, or the next map click.
  const at = (fn: (x: number, y: number) => void) => {
    if (atClick) {
      pending = fn;
      deps.toast(true, "Click on the map to place it");
    } else {
      const c = deps.centre();
      fn(c.x, c.y);
    }
  };

  const title = el("h3");
  title.append(el("span", "Creative mode"), button("×", () => (panel.hidden = true)));
  const atRow = el("div", "", { class: "cr-row" });
  atRow.append(el("span", "Place"));
  const atCentre = button("At centre", () => setAt(false));
  const atClickBtn = button("At click", () => setAt(true));
  atRow.append(atCentre, atClickBtn);
  const setAt = (v: boolean) => {
    atClick = v;
    atCentre.classList.toggle("on", !v);
    atClickBtn.classList.toggle("on", v);
  };
  setAt(false);
  const tabs = el("div", "", { class: "cr-tabs" });
  const body = el("div");
  panel.append(title, atRow, tabs, body);

  const pages: Record<string, HTMLElement> = {};
  const showTab = (name: string) => {
    for (const [k, p] of Object.entries(pages)) p.hidden = k !== name;
    tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.textContent === name));
  };
  const page = (name: string) => {
    const p = el("div");
    pages[name] = p;
    body.append(p);
    tabs.append(button(name, () => showTab(name)));
    return p;
  };

  // ---- Spawn: Yours ----
  {
    const p = page("Yours");
    const kind = select(OWN_KINDS);
    const level = select(["1", "2", "3"], (o) => `Level ${o}`);
    const gear = select(["0", "1", "2", "3"], (o) => `Gear T${o}`);
    const stance = select(["normal", "defensive", "aggressive"]);
    const form = select(["line", "block", "column", "none"]);
    const countRow = row("Count");
    const count = seg(COUNTS, 10, countRow);
    p.append(row("Unit", kind), row("Tier", level, gear), row("Stance", stance), countRow, row("Formation", form));
    p.append(row("", button("Spawn", () => at((x, y) => {
      const [k, heroClass] = kind.value.split(":");
      deps.send({ type: "creativeSpawn", side: "own", kind: k, heroClass, count: count(), x, y, formation: form.value, level: Number(level.value), gear: Number(gear.value), stance: stance.value });
    }))));
  }
  // ---- Spawn: Enemies ----
  {
    const p = page("Enemies");
    const kind = select(ENEMY_KINDS);
    const mark = select(HUNGER_MARK_NAMES.map((_, i) => String(i)), (o) => (o === "0" ? "No mark" : `Mark: ${HUNGER_MARK_NAMES[Number(o)]}`));
    const boss = select(["", "elite", "warlord"], (o) => (o === "" ? "Not a boss" : o === "elite" ? "Elite (mini-boss)" : "Warlord (e.g. Ogre Warlord)"));
    const form = select(["block", "line", "column", "none"]);
    const countRow = row("Count");
    const count = seg(COUNTS, 10, countRow);
    p.append(row("Mob", kind), row("Elite", mark, boss), countRow, row("Formation", form));
    p.append(row("", button("Spawn", () => at((x, y) => {
      deps.send({ type: "creativeSpawn", side: "enemy", kind: kind.value, count: count(), x, y, formation: form.value, mark: Number(mark.value) || undefined, boss: boss.value || undefined });
    })), button("As site guardians", () => at((x, y) => {
      deps.send({ type: "creativeSpawn", side: "guardians", kind: kind.value, count: Math.min(count(), 100), x, y });
    }))));
    p.append(el("div", "Site guardians join the fort / settlement nearest the point (max 100 at once).", { class: "cr-row" }));
  }
  // ---- Spawn: Neutrals ----
  {
    const p = page("Neutrals");
    const groups: Record<string, string[]> = {
      "Test clan soldier": OWN_KINDS,
      "Test clan worker": WORKERS,
      "Settlement folk": FOLK,
      Wildlife: WILDLIFE_KINDS as string[],
    };
    const group = select(Object.keys(groups));
    const kind = select(groups["Test clan soldier"]);
    group.addEventListener("change", () => {
      kind.replaceChildren(...groups[group.value].map((o) => el("option", o, { value: o })));
    });
    const gear = select(["0", "1", "2", "3"], (o) => `Gear T${o}`);
    const level = select(["1", "2", "3"], (o) => `Level ${o}`);
    const mode = select(["dummy", "aggressive"], (o) => (o === "dummy" ? "Dummy (stands still)" : "Aggressive (fights back)"));
    const form = select(["line", "block", "column", "none"]);
    const countRow = row("Count");
    const count = seg(COUNTS, 10, countRow);
    p.append(row("Type", group), row("Unit", kind), row("Tier", level, gear), row("Behaviour", mode), countRow, row("Formation", form));
    const spawn = (msg: object) => {
      lastNeutral = msg;
      deps.send(msg);
    };
    p.append(row("",
      button("Spawn", () => at((x, y) => {
        const side = group.value === "Wildlife" ? "wildlife" : group.value === "Settlement folk" ? "folk" : "neutral";
        const [k, heroClass] = kind.value.split(":");
        spawn({ type: "creativeSpawn", side, kind: k, heroClass, count: count(), x, y, formation: form.value, level: Number(level.value), gear: Number(gear.value), aggressive: mode.value === "aggressive" });
      })),
      button("Clear neutrals", () => deps.send({ type: "creativeSet", op: "clearNeutrals" })),
      button("Respawn last", () => {
        if (!lastNeutral) return deps.toast(false, "Nothing spawned yet");
        deps.send({ type: "creativeSet", op: "clearNeutrals" });
        deps.send(lastNeutral);
      }),
    ));
  }
  // ---- Spawn: Armies ----
  {
    const p = page("Armies");
    const faction = select(FACTIONS);
    const kind = select(["", ...ENEMY_KINDS], (o) => (o === "" ? "Faction mix" : `All ${o}`));
    const mark = select(HUNGER_MARK_NAMES.map((_, i) => String(i)), (o) => (o === "0" ? "No mark" : `Mark: ${HUNGER_MARK_NAMES[Number(o)]}`));
    const form = select(["line", "block", "column"]);
    const sizeRow = row("Size");
    const size = seg(ARMY_SIZES, 100, sizeRow);
    p.append(row("Faction", faction), row("Units", kind), row("Mark", mark), sizeRow, row("Formation", form));
    p.append(row("", button("Spawn army", () => at((x, y) => {
      deps.send({ type: "creativeSpawn", side: "army", faction: faction.value, kind: kind.value, count: size(), x, y, formation: form.value, mark: Number(mark.value) || undefined });
    }))));
    p.append(el("div", "An army is a raid group already engaged: it marches on and fights what it meets.", { class: "cr-row" }));
  }
  // ---- World ----
  {
    const p = page("World");
    const day = el("input", "", { type: "number", min: "1", value: "1" });
    p.append(row("Day", day, ...["dawn", "noon", "dusk", "night", "midnight"].map((ph) => button(ph, () => deps.send({ type: "creativeSet", op: "setTime", day: Number(day.value) || undefined, phase: ph })))));
    const raidDay = el("input", "", { type: "number", min: "1", value: "10" });
    p.append(row("Raid", el("span", "day"), raidDay, button("Raid now", () => deps.send({ type: "creativeSet", op: "raid", day: Number(raidDay.value) || 1 }))));
    const tpl = select(TEMPLATES);
    const tier = select(["1", "2", "3"], (o) => `Tier ${o}`);
    p.append(el("div", "", { class: "cr-sec" }), row("Stamp", tpl, tier, button("Stamp", () => at((x, y) => deps.send({ type: "creativeSet", op: "stamp", template: tpl.value, tier: Number(tier.value), x, y })))));
    // Forts phase G: a warband from the nearest map edge that camps at the click; grow the nearest camp / fort.
    const wbFaction = select(["bandit", "orc"]);
    p.append(row("Warband", wbFaction,
      button("Spawn (camps at click)", () => at((x, y) => deps.send({ type: "creativeSet", op: "warband", faction: wbFaction.value, x, y }))),
      button("Grow camp", () => at((x, y) => deps.send({ type: "creativeSet", op: "growCamp", x, y }))),
    ));
    p.append(row("Trade", button("Trading Post + wagon", () => at((x, y) => deps.send({ type: "creativeSet", op: "tradingPost", x, y, level: 1 })))));
    const rel = el("input", "", { type: "number", min: "-100", max: "100", value: "100" });
    p.append(el("div", "", { class: "cr-sec" }), row("Relation", rel,
      button("Set", () => at((x, y) => deps.send({ type: "creativeSet", op: "relation", x, y, value: Number(rel.value) }))),
      button("Vassalise", () => at((x, y) => deps.send({ type: "creativeSet", op: "relation", x, y, value: 100, vassal: true }))),
      button("Free", () => at((x, y) => deps.send({ type: "creativeSet", op: "relation", x, y, vassal: false }))),
    ));
    const quest = select(["deliver", "defend", "clearCamp"]);
    p.append(row("Quest", quest, button("Post", () => at((x, y) => deps.send({ type: "creativeSet", op: "quest", x, y, kind: quest.value })))));
    p.append(el("div", "Relation / quest act on the human settlement nearest the point.", { class: "cr-row" }));
  }
  // ---- Tools ----
  const godBtn = button("Godmode: off", () => deps.send({ type: "creativeSet", op: "godmode", on: !godmode }));
  const atkBtn = button("Allow attacking neutrals: off", () => deps.send({ type: "creativeSet", op: "allowAttack", on: !allowAttack }));
  const syncToggles = () => {
    godBtn.textContent = `Godmode: ${godmode ? "ON" : "off"}`;
    godBtn.classList.toggle("on", godmode);
    atkBtn.textContent = `Allow attacking neutrals: ${allowAttack ? "ON" : "off"}`;
    atkBtn.classList.toggle("on", allowAttack);
  };
  {
    const p = page("Tools");
    p.append(row("Player", godBtn), row("Neutrals", atkBtn));
    p.append(row("World",
      button("Heal all", () => deps.send({ type: "creativeSet", op: "heal" })),
      button("Kill all monsters", () => deps.send({ type: "creativeSet", op: "killMobs" })),
      button("Clear neutrals", () => deps.send({ type: "creativeSet", op: "clearNeutrals" })),
      button("Clear wildlife", () => deps.send({ type: "creativeSet", op: "clearWildlife" })),
    ));
  }
  const help = el("div", "", { class: "cr-sec" });
  const ul = el("ul");
  for (const h of HELP) ul.append(el("li", h));
  help.append(el("b", "Help"), ul);
  panel.append(help);
  showTab("Yours");
  syncToggles();

  return {
    get on() {
      return on;
    },
    onWelcome(creative: boolean) {
      on = creative;
      btn.hidden = !creative;
      if (!creative) {
        panel.hidden = true;
        pending = null;
      }
    },
    onSnapshot(snap: { creative?: { allowAttack: boolean }; wildlife?: number[] }) {
      wildlifeFlat = snap.wildlife ?? [];
      const a = snap.creative?.allowAttack ?? false;
      if (a !== allowAttack) {
        allowAttack = a;
        syncToggles();
      }
    },
    onResult(m: { op: string; ok: boolean; text: string; on?: unknown }) {
      if (m.op === "godmode" && m.ok) {
        godmode = m.on === true;
        syncToggles();
      }
      deps.toast(m.ok, m.text);
    },
    // A left-click on the map while a placement waits: place it there.
    consumeClick(x: number, y: number): boolean {
      if (!on || !pending) return false;
      const fn = pending;
      pending = null;
      fn(x, y);
      return true;
    },
    // Ctrl+right-click with soldiers selected: force-attack the other clan's unit or animal under the cursor.
    forceAttackAt(x: number, y: number, colonists: ColonistSnapshot[], myClan: number, hitPx: number): boolean {
      if (!on) return false;
      let best: { type: "c" | "w"; id: string } | null = null;
      let bestD = hitPx;
      for (const c of colonists) {
        if ((c.clan ?? 0) === myClan) continue;
        const d = Math.hypot(c.x - x, c.y - y);
        if (d < bestD) {
          bestD = d;
          best = { type: "c", id: c.id };
        }
      }
      for (let i = 0; i + 3 < wildlifeFlat.length; i += WILDLIFE_SNAPSHOT_STRIDE) {
        const d = Math.hypot(wildlifeFlat[i + 2] - x, wildlifeFlat[i + 3] - y);
        if (d < bestD) {
          bestD = d;
          best = { type: "w", id: String(wildlifeFlat[i]) };
        }
      }
      if (!best) return false;
      deps.send({ type: "creativeSet", op: "forceAttack", unitIds: deps.selectedIds(), targetType: best.type, targetId: best.id });
      return true;
    },
  };
}
