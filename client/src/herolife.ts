// Solo hero phases 1-3 (docs PLAN-solo-hero.md; server/src/herolife.ts): the client side. Self-contained DOM: the
// dialogue panel (portrait, short lines, 2-6 choices; 1-6 picks, Esc says farewell), needs meters + a Pack button in
// the hero bar, the pack / skills / actions panel, and a hold-E progress ring. E (held) = interact: the server talks,
// gathers or starts station work; with nothing there the main view's building panel opens (fallback).
import {
  HERO_SKILL_LABEL, PACK_GOODS, PACK_LABEL, PERSONAL_BUILDS, type DialogueSnapshot, type HeroLifeSnapshot,
  type PersonalBuild,
} from "@colony/shared/herolife";
import type { ServerMessage } from "@colony/shared/protocol";
import type { FamilyMemberSnapshot } from "@colony/shared/herolife";

export interface HeroLifeDeps {
  send: (msg: object) => void;
  openBuildingInfo: (tx: number, ty: number) => void;
  fallbackInteract: () => void;
  // Strategy view / a typing field / a modal: E does nothing.
  blocked: () => boolean;
  // Opens the one hero sheet (pack left, character centre, family right): the hero bar's Pack / Family buttons.
  openSheet: () => void;
  // Stardew phase 5a (herotools.ts): the hotbar tool in hand and the faced tile, sent with E.
  interactFields?: () => object;
}

export interface HeroLifeUi {
  onMessage: (m: ServerMessage) => void;
  onLife: (life: HeroLifeSnapshot) => void;
}

const CSS = `
#hero-bar { width: 250px; }
#hl-dialogue { position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%); z-index: 30; width: min(520px, calc(100vw - 32px));
  display: flex; gap: 10px; padding: 10px 12px; background: var(--burn-sm, none), var(--paper, #e8d9b5); background-color: var(--parch-mid, #e2cfa2);
  border: 1px solid var(--wood-dark, #4a2f18); border-radius: 4px; box-shadow: 0 4px 14px rgba(0,0,0,.6); font-size: 13px; color: #2b1a0b; }
#hl-dialogue[hidden] { display: none; }
#hl-portrait { flex: 0 0 56px; height: 56px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  font: bold 24px var(--font-serif, serif); color: #fff; text-shadow: 0 1px 2px #000; border: 2px solid var(--wood-dark, #4a2f18); }
#hl-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
#hl-who { font-family: var(--font-serif, serif); font-weight: bold; }
#hl-who small { font-weight: normal; opacity: .75; margin-left: 6px; }
#hl-text { white-space: pre-wrap; line-height: 1.35; }
#hl-choices { display: flex; flex-direction: column; gap: 3px; }
#hl-choices button { text-align: left; font-size: 12px; padding: 3px 6px; }
#hl-choices button[disabled] { opacity: .5; }
#hl-ring { position: fixed; left: 50%; top: 42%; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; z-index: 25;
  pointer-events: none; background: conic-gradient(#f2c94c var(--p, 0%), rgba(0,0,0,.35) 0); -webkit-mask: radial-gradient(circle, transparent 10px, #000 11px);
  mask: radial-gradient(circle, transparent 10px, #000 11px); }
#hl-ring[hidden] { display: none; }
#hl-ring-label { position: fixed; left: 50%; top: calc(42% + 22px); transform: translateX(-50%); z-index: 25; pointer-events: none;
  font-size: 11px; color: #fff; text-shadow: 0 0 3px #000; white-space: nowrap; }
#hl-ring-label[hidden] { display: none; }
.hl-needs { display: flex; gap: 4px; align-items: center; font-size: 10px; }
.hl-needs .hb-meter { flex: 1; height: 6px; }
#hl-food { background: #e69138; }
#hl-rest { background: #6fa8dc; }
#hl-status { font-size: 10px; color: #8b1a1a; min-height: 0; }
#hs-needs .hl-food { background: #e69138; }
#hs-needs .hl-rest { background: #6fa8dc; }
#hs-needs .hl-energy { background: #5cc34a; }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text) e.textContent = text;
  return e;
}

export function setupHeroLife(deps: HeroLifeDeps): HeroLifeUi {
  const style = el("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  // Dialogue panel.
  const dlg = el("div", { id: "hl-dialogue", hidden: "" });
  const portrait = el("div", { id: "hl-portrait" });
  const body = el("div", { id: "hl-body" });
  const who = el("div", { id: "hl-who" });
  const text = el("div", { id: "hl-text" });
  const choicesEl = el("div", { id: "hl-choices" });
  body.append(who, text, choicesEl);
  dlg.append(portrait, body);
  document.body.appendChild(dlg);
  let current: DialogueSnapshot | null = null;

  // Progress ring.
  const ring = el("div", { id: "hl-ring", hidden: "" });
  const ringLabel = el("div", { id: "hl-ring-label", hidden: "" });
  document.body.append(ring, ringLabel);

  // Needs + Pack button in the hero bar (if it is there).
  const bar = document.getElementById("hero-bar");
  const needs = el("div", { class: "hl-needs", title: "Food and rest: below a quarter you slow down and stop healing" });
  const foodM = el("div", { class: "hb-meter" });
  const foodF = el("div", { id: "hl-food", class: "hb-fill" });
  foodM.appendChild(foodF);
  const restM = el("div", { class: "hb-meter" });
  const restF = el("div", { id: "hl-rest", class: "hb-fill" });
  restM.appendChild(restF);
  const loadT = el("span", {}, "0/40");
  needs.append(el("span", {}, "Food"), foodM, el("span", {}, "Rest"), restM, loadT);
  const status = el("div", { id: "hl-status" });
  const packBtn = el("button", { class: "cmd-btn", id: "hl-pack-btn", title: "Hero sheet: your pack, skills and hero actions (eat, rest, deposit, build)" }, "Pack");
  const famBtn = el("button", { class: "cmd-btn", id: "hl-family-btn", title: "Hero sheet: your family, spouse, children, kin and the succession order" }, "Family");
  if (bar) {
    bar.insertBefore(needs, bar.querySelector(".hb-keys"));
    bar.insertBefore(status, bar.querySelector(".hb-keys"));
    bar.querySelector(".hb-keys")?.insertBefore(packBtn, bar.querySelector(".hb-hint"));
    bar.querySelector(".hb-keys")?.insertBefore(famBtn, bar.querySelector(".hb-hint"));
    const interactBtn = document.getElementById("hb-interact");
    if (interactBtn) interactBtn.title = "Talk / gather (hold) / work next to you (E); Enter opens the building";
  }

  // The hero sheet's columns (index.html #hero-modal): pack and actions left, needs + skills centre, family right.
  const host = (id: string) => document.getElementById(id) ?? document.body.appendChild(el("div", { id, class: "hl-box", hidden: "" }));
  const panel = host("hs-life");
  const needsBox = host("hs-needs");
  const skillsBox = host("hs-skills");
  const famPanel = host("hs-family");
  let life: HeroLifeSnapshot | null = null;
  for (const b of [packBtn, famBtn]) {
    b.addEventListener("click", () => {
      b.blur();
      deps.openSheet();
    });
  }

  // Family (docs PLAN-family-and-succession.md): read-only; courtship and marriage happen in dialogue.
  function renderFamily() {
    famPanel.textContent = "";
    famPanel.appendChild(el("div", { class: "menu-section" }, "Family"));
    const f = life?.family;
    if (!f) {
      famPanel.appendChild(el("div", {}, "No family yet."));
      return;
    }
    famPanel.appendChild(el("h4", {}, `${f.name}${f.gen > 1 ? ` (generation ${f.gen})` : ""}`));
    const row = (a: string, b: string) => {
      const r = el("div", { class: "hl-row" });
      r.append(el("span", {}, a), el("span", {}, b));
      famPanel.appendChild(r);
    };
    const who = (m: FamilyMemberSnapshot) => `${m.ageDays ?? 0} days${m.child ? ", a child" : ""}${m.from ? `, of ${m.from}` : ""}`;
    if (f.spouse) row(`Spouse: ${f.spouse.name}`, who(f.spouse));
    else if (f.betrothed) row(`Betrothed: ${f.betrothed}`, "find a priest");
    else row("Unwed", "");
    for (const c of f.courting) row(`Courting ${c.name}`, `${c.points} / ${c.need}`);
    const list = (title: string, ms: FamilyMemberSnapshot[]) => {
      if (ms.length === 0) return;
      famPanel.appendChild(el("h4", {}, title));
      for (const m of ms) row(m.name, who(m));
    };
    list("Children", f.children);
    list("Parents", f.parents);
    list("Siblings", f.siblings);
    famPanel.appendChild(el("h4", {}, "Succession"));
    famPanel.appendChild(el("div", {}, f.heirs.length ? f.heirs.map((h, i) => `${i + 1}. ${h}`).join("  ") : "Nobody: your line ends with you."));
    if (!f.spouse && !f.betrothed) {
      famPanel.appendChild(el("div", { class: "hl-hint" }, "Court one of your people by talking to them (E), or ask a friendly Elder to \"Speak of family\"."));
    }
  }
  panel.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    if (!b) return;
    b.blur();
    deps.send({ type: "heroAction", action: b.dataset.act, ...(b.dataset.build ? { build: b.dataset.build } : {}) });
  });

  function renderNeeds() {
    needsBox.textContent = "";
    if (!life) return;
    needsBox.appendChild(el("div", { class: "menu-section" }, "Needs"));
    for (const [label, v, cls] of [["Food", life.food, "hl-food"], ["Rest", life.rest, "hl-rest"], ["Energy", life.energy, "hl-energy"]] as const) {
      const r = el("div", { class: "hl-row" });
      r.append(el("span", {}, label), el("span", {}, `${Math.round(v)}%`));
      const m = el("div", { class: "hb-meter" });
      const f = el("div", { class: `hb-fill ${cls}` });
      f.style.width = `${v}%`;
      m.appendChild(f);
      needsBox.append(r, m);
    }
    const st = [...(life.slow ?? []), ...(life.resting ? ["Resting"] : [])].join(", ");
    needsBox.appendChild(el("div", {}, life.needs ? st || "Fed and rested" : "Needs are off in this game"));
  }

  function renderPanel() {
    if (!life) return;
    panel.textContent = "";
    panel.appendChild(el("h4", {}, `Carried goods (${life.weight} / ${life.cap})`));
    const goods = PACK_GOODS.filter((g) => (life!.pack[g] ?? 0) > 0);
    if (goods.length === 0) panel.appendChild(el("div", {}, "Empty"));
    for (const g of goods) {
      const r = el("div", { class: "hl-row" });
      r.append(el("span", {}, PACK_LABEL[g]), el("span", {}, String(life.pack[g])));
      panel.appendChild(r);
    }
    const acts = el("div", { class: "hl-actions" });
    acts.append(
      el("button", { "data-act": "eat", class: "cmd-btn", title: "Eat from the pack (or your stores, near home)" }, "Eat"),
      el("button", { "data-act": "rest", class: "cmd-btn", title: "Sit and rest; faster by a campfire, lean-to or home. Move to stop" }, life.resting ? "Get up" : "Rest"),
      el("button", { "data-act": "deposit", class: "cmd-btn", title: "Empty the pack into your stores (at a Town Center or storage chest)" }, "Deposit"),
    );
    if (life.canFound) {
      acts.appendChild(el("button", { "data-act": "foundCamp", class: "cmd-btn", title: "Found a camp here: a Town Center next to you and two settlers join (20 wood + 10 stone, pack first)" }, "Found a camp"));
    }
    panel.appendChild(acts);
    panel.appendChild(el("h4", {}, `Build by hand (${life.builds} placed)`));
    const builds = el("div", { class: "hl-actions" });
    for (const [k, d] of Object.entries(PERSONAL_BUILDS) as [PersonalBuild, (typeof PERSONAL_BUILDS)[PersonalBuild]][]) {
      const cost = Object.entries(d.cost).map(([g, n]) => `${n} ${g}`).join(" + ");
      builds.appendChild(el("button", { "data-act": "build", "data-build": k, class: "cmd-btn", title: `${d.desc} Costs ${cost} (pack first, then stores).` }, d.label));
    }
    panel.appendChild(builds);
    skillsBox.textContent = "";
    skillsBox.appendChild(el("div", { class: "menu-section" }, "Skills"));
    const known = life.skills.filter((s) => s.xp > 0);
    if (known.length === 0) skillsBox.appendChild(el("div", {}, "None yet: gather, craft at stations, trade and talk to learn."));
    for (const s of known) {
      const r = el("div", { class: "hl-row" });
      r.append(el("span", {}, `${HERO_SKILL_LABEL[s.id]} L${s.level}`), el("span", {}, s.next === null ? "master" : `${s.next} to next`));
      skillsBox.appendChild(r);
    }
  }

  function renderDialogue(d: DialogueSnapshot) {
    current = d;
    dlg.hidden = false;
    portrait.textContent = d.npc.name.replace(/^(Elder|Brother) /, "").charAt(0);
    portrait.style.background = `#${d.npc.color.toString(16).padStart(6, "0")}`;
    who.textContent = d.npc.name;
    const sub = el("small", {}, [d.npc.roleLabel, d.npc.site, d.npc.tier].filter(Boolean).join(" · "));
    who.appendChild(sub);
    text.textContent = d.text;
    choicesEl.textContent = "";
    d.choices.forEach((c, i) => {
      const b = el("button", { class: "cmd-btn" }, `${i + 1}. ${c.label}`);
      if (c.disabled) {
        b.disabled = true;
        b.title = c.disabled;
        b.textContent += ` (${c.disabled})`;
      }
      b.addEventListener("click", () => choose(i));
      choicesEl.appendChild(b);
    });
  }
  function closeDialogue() {
    current = null;
    dlg.hidden = true;
  }
  function choose(i: number) {
    if (!current || !current.choices[i] || current.choices[i].disabled) return;
    deps.send({ type: "dialogueChoice", choice: i });
  }

  // E held = interact; 1-6 / Esc while talking.
  let eDown = false;
  window.addEventListener(
    "keydown",
    (e) => {
      if (current && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const n = Number(e.key);
        if (Number.isInteger(n) && n >= 1 && n <= current.choices.length && !e.shiftKey) {
          e.preventDefault();
          e.stopImmediatePropagation();
          choose(n - 1);
          return;
        }
        if (e.key === "Escape") {
          const bye = current.choices.findIndex((c) => /^Farewell/.test(c.label));
          if (bye >= 0) choose(bye);
          closeDialogue();
          e.stopImmediatePropagation();
          return;
        }
      }
      if (e.code !== "KeyE" || e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select")) return;
      if (deps.blocked()) return;
      e.preventDefault();
      eDown = true;
      deps.send({ type: "interact", ...(deps.interactFields?.() ?? {}) });
    },
    true,
  );
  window.addEventListener("keyup", (e) => {
    if (e.code !== "KeyE" || !eDown) return;
    eDown = false;
    deps.send({ type: "gatherStop" });
  });
  window.addEventListener("blur", () => {
    if (eDown) deps.send({ type: "gatherStop" });
    eDown = false;
  });

  let lastPanel = "";
  let lastNeeds = "";
  let lastFamily = "";
  return {
    onMessage(m) {
      if (m.type === "dialogue") {
        if (m.close) closeDialogue();
        else if (m.dialogue) renderDialogue(m.dialogue);
        if (m.openTrade) deps.openBuildingInfo(m.openTrade.tileX, m.openTrade.tileY);
      } else if (m.type === "interactNone") {
        deps.fallbackInteract();
      }
    },
    onLife(l) {
      life = l;
      foodF.style.width = `${l.food}%`;
      restF.style.width = `${l.rest}%`;
      needs.style.opacity = l.needs ? "1" : "0.45";
      loadT.textContent = `${l.weight}/${l.cap}`;
      const st = [...(l.slow ?? []), ...(l.resting ? ["Resting"] : [])].join(", ");
      if (status.textContent !== st) status.textContent = st;
      const nk = JSON.stringify([Math.round(l.food), Math.round(l.rest), Math.round(l.energy), st, l.needs]);
      if (nk !== lastNeeds) {
        lastNeeds = nk;
        renderNeeds();
      }
      const job = l.gather ?? l.work;
      ring.hidden = !job;
      ringLabel.hidden = !job;
      if (job) {
        ring.style.setProperty("--p", `${Math.round(job.p * 100)}%`);
        ringLabel.textContent = job.label;
      }
      const fk = JSON.stringify(l.family ?? null);
      if (fk !== lastFamily) {
        lastFamily = fk;
        renderFamily();
      }
      const key = JSON.stringify([l.pack, l.skills, l.builds, l.resting, l.weight, l.canFound]);
      if (key !== lastPanel) {
        lastPanel = key;
        renderPanel();
      }
    },
  };
}
