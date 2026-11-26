// Small DOM helpers: element builder, toasts, a modal form (no prompt() dialogs) and a status line.
type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === "function") e.addEventListener(k.replace(/^on/, ""), v as EventListener);
    else if (k === "class") e.className = String(v);
    else if (k === "text") e.textContent = String(v);
    else if (v === true) e.setAttribute(k, "");
    else e.setAttribute(k, String(v));
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}
export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

export function toast(msg: string, kind: "ok" | "err" | "info" = "info", ms = 3200): void {
  let box = document.getElementById("toasts");
  if (!box) { box = el("div", { id: "toasts" }); document.body.append(box); }
  const t = el("div", { class: "toast " + kind, role: kind === "err" ? "alert" : "status", text: msg });
  box.append(t);
  setTimeout(() => t.remove(), kind === "err" ? ms * 2 : ms);
}

export type Field = { key: string; label: string; type?: "text" | "number" | "select" | "checkbox" | "file"; value?: string | number | boolean; options?: [string, string][]; accept?: string; hint?: string };
/** A modal form. Resolves with the values (files as File) or null on cancel. */
export function ask(title: string, fields: Field[], okText = "OK"): Promise<Record<string, any> | null> {
  return new Promise((resolve) => {
    const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
    const form = el("form", { class: "modal-form" }, el("h3", { text: title }));
    for (const f of fields) {
      let input: HTMLInputElement | HTMLSelectElement;
      if (f.type === "select") {
        input = el("select", { name: f.key });
        for (const [v, t] of f.options || []) input.append(el("option", { value: v, text: t, selected: String(f.value) === v }));
      } else {
        input = el("input", { name: f.key, type: f.type || "text", accept: f.accept });
        if (f.type === "checkbox") (input as HTMLInputElement).checked = !!f.value;
        else if (f.value !== undefined) input.value = String(f.value);
      }
      inputs.set(f.key, input);
      form.append(el("label", { class: f.type === "checkbox" ? "check" : "" }, el("span", { text: f.label }), input, f.hint ? el("small", { text: f.hint }) : null));
    }
    const close = (v: Record<string, any> | null) => { back.remove(); resolve(v); };
    form.append(el("div", { class: "row end" },
      el("button", { type: "button", class: "ghost", text: "Cancel", onclick: () => close(null) }),
      el("button", { type: "submit", class: "primary", text: okText })));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const out: Record<string, any> = {};
      for (const f of fields) {
        const i = inputs.get(f.key)!;
        out[f.key] = f.type === "checkbox" ? (i as HTMLInputElement).checked : f.type === "number" ? Number(i.value) : f.type === "file" ? (i as HTMLInputElement).files?.[0] ?? null : i.value;
      }
      close(out);
    });
    const back = el("div", { class: "modal-back", onkeydown: (e: Event) => { if ((e as KeyboardEvent).key === "Escape") close(null); } }, form);
    document.body.append(back);
    (form.querySelector("input,select") as HTMLElement | null)?.focus();
  });
}
export async function confirmBox(text: string, okText = "Continue"): Promise<boolean> {
  return (await ask(text, [], okText)) !== null;
}
