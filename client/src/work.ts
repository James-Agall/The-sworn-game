// Modular building phase 4 (shared/src/work.ts): the client side of job priorities. The Work tab (top bar "Work"):
// a table of the clan's adult civilians x work types. Click a cell to cycle its priority (manual mode: 1 -> 2 -> 3 ->
// 4 -> off; right-click goes the other way; default mode: on / off), click a column header to set the whole column
// (all off, or all back on), hover a cell for the skill. Sorting by name or by the skill in a work type; a toggle
// switches between default and manual priorities. Also the small person card a click on a villager / worker opens
// (name, role, current job, priorities). The table is fetched with `workTab` once a second while either is open.
// Gap closure G3: the card's "Assign to..." lists nearby open posts (workPosts) for a free villager, "Unassign" sends a
// post worker back to the village; hand-assigned (pinned) workers carry a ⚑ in their post's cell.
import type { ClientMessage } from "@colony/shared/protocol";
import { WORK_HELP, WORK_LABEL, WORK_PRIORITY_MAX, WORK_SHORT, WORK_TYPES, type WorkPostOption, type WorkTabRow, type WorkTabSnapshot } from "@colony/shared/work";
import { WORK_ICON, iconImg, priorityIconUrl } from "./spriteRegistry";

export interface WorkUi {
  onTab(tab: WorkTabSnapshot): void;
  // Reply to workPosts: the open posts near the person on the card.
  onPosts(id: string, posts: WorkPostOption[]): void;
  toggle(): void;
  setOpen(open: boolean): void;
  isOpen(): boolean;
  // The person card for a colonist (name shown until the table answers; child: "too young to work").
  showPerson(id: string, name: string, child: boolean): void;
  hidePerson(): void;
  reset(): void;
}

const SKILL_WORD = ["", "novice", "skilled", "expert", "master"];

export function setupWork(opts: { send: (m: ClientMessage) => void; button: HTMLButtonElement }): WorkUi {
  const panel = document.getElementById("work-panel")!;
  const body = document.getElementById("wp-table")!;
  const modeBtn = document.getElementById("wp-mode") as HTMLButtonElement;
  const sortSel = document.getElementById("wp-sort") as HTMLSelectElement;
  const card = document.getElementById("person-card")!;
  const assignBtn = document.getElementById("pc-assign") as HTMLButtonElement;
  const unassignBtn = document.getElementById("pc-unassign") as HTMLButtonElement;
  const postsEl = document.getElementById("pc-posts")!;
  // The card's "Assign to..." list: open for this person id (null = closed).
  let postsFor: string | null = null;
  let tab: WorkTabSnapshot | null = null;
  let open = false;
  let cardId: string | null = null;
  let cardFallback = { name: "", child: false };
  let poll: number | undefined;
  let tabSig = "";

  for (const t of WORK_TYPES) {
    const o = document.createElement("option");
    o.value = t;
    o.textContent = `${WORK_LABEL[t]} skill`;
    sortSel.append(o);
  }
  sortSel.addEventListener("change", () => render());
  modeBtn.addEventListener("click", () => {
    modeBtn.blur();
    if (tab) opts.send({ type: "workMode", manual: !tab.manual });
  });
  opts.button.addEventListener("click", () => {
    opts.button.blur();
    setOpen(!open);
  });
  document.getElementById("wp-close")!.addEventListener("click", () => setOpen(false));
  document.getElementById("pc-close")!.addEventListener("click", () => hidePerson());
  document.getElementById("pc-open")!.addEventListener("click", () => setOpen(true));
  assignBtn.addEventListener("click", () => {
    assignBtn.blur();
    if (!cardId) return;
    if (postsFor === cardId) {
      postsFor = null;
      postsEl.hidden = true;
      return;
    }
    postsFor = cardId;
    postsEl.hidden = false;
    postsEl.textContent = "Looking for open posts...";
    opts.send({ type: "workPosts", id: cardId });
  });
  unassignBtn.addEventListener("click", () => {
    unassignBtn.blur();
    if (cardId) opts.send({ type: "unassignWorker", id: cardId });
  });
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (open) setOpen(false);
    else if (cardId) hidePerson();
  });

  function syncPoll() {
    const want = open || cardId !== null;
    if (want && poll === undefined) {
      opts.send({ type: "workTab" });
      poll = window.setInterval(() => opts.send({ type: "workTab" }), 1000);
    } else if (!want && poll !== undefined) {
      window.clearInterval(poll);
      poll = undefined;
    }
  }
  function setOpen(o: boolean) {
    open = o;
    panel.hidden = !o;
    opts.button.classList.toggle("panel-open", o);
    syncPoll();
    render();
  }

  // Next value of a cell: manual 1 -> 2 -> 3 -> 4 -> off -> 1 (back: the other way); default on <-> off.
  function nextPriority(p: number, back: boolean): number {
    if (!tab?.manual) return p > 0 ? 0 : 3;
    const order = [1, 2, 3, 4, 0];
    const i = order.indexOf(p);
    return order[(i + (back ? order.length - 1 : 1)) % order.length];
  }
  function setCell(ids: string[], ti: number, p: number) {
    opts.send({ type: "workSet", ids, work: WORK_TYPES[ti], priority: p });
  }

  function cellTitle(r: WorkTabRow, ti: number): string {
    const t = WORK_TYPES[ti];
    const p = r.pri[ti];
    const skill = r.skill[ti] > 0 ? `skill level ${r.skill[ti]} (${SKILL_WORD[r.skill[ti]]}, ${Math.floor(r.xp[ti])} XP)` : "no skill (anyone can)";
    const prio = p > 0 ? (tab?.manual ? `priority ${p}` : "on") : "off";
    const assigned = r.assigned === t ? (r.pinned ? "\nAssigned by hand: kept until unassigned or this is off" : "\nAssigned post: kept while this is not off") : "";
    const how = tab?.manual ? "Click: next priority (1 first .. 4, off) · right-click: back" : "Click: on / off (Manual priorities for numbers)";
    return `${r.name} · ${WORK_LABEL[t]}: ${prio}, ${skill}${assigned}\n${WORK_HELP[t]}\n${how}`;
  }

  function render() {
    if (tab) {
      modeBtn.textContent = tab.manual ? "Manual priorities: on" : "Manual priorities: off";
      modeBtn.classList.toggle("active", tab.manual);
    }
    if (open) renderTable();
    renderCard();
  }

  function renderTable() {
    body.replaceChildren();
    if (!tab) return;
    const sortBy = sortSel.value;
    const si = WORK_TYPES.indexOf(sortBy as (typeof WORK_TYPES)[number]);
    const rows = [...tab.rows].sort((a, b) => (si >= 0 ? b.xp[si] - a.xp[si] : 0) || a.name.localeCompare(b.name));
    const table = document.createElement("table");
    table.className = "wp-grid";
    const head = document.createElement("tr");
    const nameTh = document.createElement("th");
    nameTh.textContent = "Name";
    nameTh.className = "wp-name-h";
    nameTh.title = "Click: sort by name";
    nameTh.addEventListener("click", () => {
      sortSel.value = "name";
      render();
    });
    head.append(nameTh);
    WORK_TYPES.forEach((t, ti) => {
      const th = document.createElement("th");
      th.className = "wp-col";
      th.append(iconImg(WORK_ICON[t], 18), document.createElement("br"), WORK_SHORT[t]);
      const anyOn = tab!.rows.some((r) => r.pri[ti] > 0);
      th.title = `${WORK_LABEL[t]}: ${WORK_HELP[t]}\nClick: ${anyOn ? "everyone off" : "everyone on"} · Shift+click: sort by skill`;
      th.addEventListener("click", (e) => {
        if (e.shiftKey) {
          sortSel.value = t;
          render();
          return;
        }
        setCell(tab!.rows.map((r) => r.id), ti, anyOn ? 0 : 3);
      });
      head.append(th);
    });
    const jobTh = document.createElement("th");
    jobTh.textContent = "Doing now";
    head.append(jobTh);
    table.append(head);
    for (const r of rows) {
      const tr = document.createElement("tr");
      if (r.id === cardId) tr.className = "wp-hl";
      const name = document.createElement("td");
      name.className = "wp-name";
      const strong = document.createElement("b");
      strong.textContent = r.name;
      const role = document.createElement("small");
      role.textContent = r.role;
      name.append(strong, role);
      tr.append(name);
      WORK_TYPES.forEach((t, ti) => {
        const td = document.createElement("td");
        const p = r.pri[ti];
        td.className = `wp-cell${p === 0 ? " off" : ""}${r.assigned === t ? " assigned" : ""}`;
        td.title = cellTitle(r, ti);
        const badge = tab!.manual || p === 0 ? iconImg(priorityIconUrl(p), 18) : document.createElement("span");
        if (!(badge instanceof HTMLImageElement)) {
          badge.className = "wp-on";
          badge.textContent = "✓";
        }
        td.append(badge);
        if (r.pinned && r.assigned === t) {
          const pin = document.createElement("span");
          pin.className = "wp-pin";
          pin.textContent = "⚑";
          td.append(pin);
        }
        // Skill level next to the badge once the person has any XP in it (everyone starts at level 1).
        if (r.skill[ti] > 0 && r.xp[ti] > 0) {
          const sk = document.createElement("sup");
          sk.textContent = String(r.skill[ti]);
          td.append(sk);
        }
        td.addEventListener("click", () => setCell([r.id], ti, nextPriority(p, false)));
        td.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          setCell([r.id], ti, nextPriority(p, true));
        });
        tr.append(td);
      });
      const job = document.createElement("td");
      job.className = "wp-job";
      job.textContent = r.job;
      tr.append(job);
      table.append(tr);
    }
    body.append(table);
    if (rows.length === 0) body.textContent = "Nobody to give work to: adults of your settlements show here (children and soldiers do not).";
  }

  function renderCard() {
    card.hidden = cardId === null;
    if (cardId === null) return;
    const r = tab?.rows.find((x) => x.id === cardId);
    const title = document.getElementById("pc-name")!;
    const role = document.getElementById("pc-role")!;
    const job = document.getElementById("pc-job")!;
    const pri = document.getElementById("pc-pri")!;
    title.textContent = r?.name ?? cardFallback.name;
    if (!r) {
      role.textContent = cardFallback.child ? "A child: too young to work" : "Not on the work roster (a soldier, priest or levy)";
      job.textContent = "";
      pri.replaceChildren();
      assignBtn.hidden = unassignBtn.hidden = postsEl.hidden = true;
      return;
    }
    // G3: free villagers can be assigned to a post, post workers unassigned (levied / training people neither).
    const free = r.role === "Free villager";
    assignBtn.hidden = !free;
    unassignBtn.hidden = !r.assigned;
    unassignBtn.title = "Back to the village: the post opens for someone else";
    if (!free && postsFor === r.id) postsFor = null;
    postsEl.hidden = postsFor !== r.id;
    role.textContent = r.role;
    job.textContent = `Doing now: ${r.job}`;
    pri.replaceChildren();
    // Its work types by priority (off ones left out), skill after the name.
    const order = WORK_TYPES.map((t, ti) => ({ t, ti, p: r.pri[ti] })).filter((x) => x.p > 0).sort((a, b) => a.p - b.p || a.ti - b.ti);
    for (const { t, ti, p } of order.slice(0, WORK_PRIORITY_MAX + 4)) {
      const chip = document.createElement("span");
      chip.className = "pc-chip";
      chip.title = cellTitle(r, ti);
      chip.append(iconImg(priorityIconUrl(tab!.manual ? p : 0), 14), iconImg(WORK_ICON[t], 14), ` ${WORK_LABEL[t]}${r.xp[ti] > 0 ? ` (skill ${r.skill[ti]})` : ""}`);
      if (!tab!.manual) chip.firstChild?.remove();
      pri.append(chip);
    }
  }

  function showPerson(id: string, name: string, child: boolean) {
    if (cardId !== id) postsFor = null;
    cardId = id;
    cardFallback = { name, child };
    syncPoll();
    render();
  }
  function hidePerson() {
    cardId = null;
    postsFor = null;
    syncPoll();
    render();
  }

  return {
    onTab(t) {
      // Polled once a second: only redraw on a change (a redraw drops the hovered cell's tooltip).
      const sig = JSON.stringify(t);
      if (sig === tabSig) return;
      tabSig = sig;
      tab = t;
      render();
    },
    onPosts(id, posts) {
      if (id !== postsFor) return;
      postsEl.replaceChildren();
      if (posts.length === 0) {
        postsEl.textContent = "No open post nearby for the jobs this person has on.";
        return;
      }
      for (const p of posts) {
        const line = document.createElement("div");
        line.className = "bpw-line";
        const span = document.createElement("span");
        span.append(iconImg(WORK_ICON[p.work], 14), ` ${p.name} · ${p.dist} tiles${p.skill > 0 ? ` · skill ${p.skill}` : ""}`);
        span.title = p.bump ? "Full: a worker placed by priorities gives way" : `${p.open} open`;
        const b = document.createElement("button");
        b.className = "econ-btn";
        b.textContent = p.bump ? "Replace" : "Assign";
        b.addEventListener("click", () => {
          postsFor = null;
          postsEl.hidden = true;
          opts.send({ type: "assignWorker", id, tileX: p.tx, tileY: p.ty });
        });
        line.append(span, b);
        postsEl.append(line);
      }
    },
    toggle: () => setOpen(!open),
    setOpen,
    isOpen: () => open,
    showPerson,
    hidePerson,
    reset() {
      tab = null;
      tabSig = "";
      hidePerson();
      setOpen(false);
    },
  };
}
