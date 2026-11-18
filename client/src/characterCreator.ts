import { DEFAULT_HERO_APPEARANCE, HORSE_COATS, PLAYER_WEAPON_KINDS, sanitizeHeroAppearance, type HeroAppearance, type HeroVisual } from "@colony/shared/protocol";
import { heroFrame, loadHeroRig, heroRigReady, type HeroPose } from "./heroRig";
import { heroArt, loadHeroAppearanceArt } from "./heroAppearance";
const stops = new WeakMap<HTMLElement, () => void>();
export function renderCharacterEditor(root: HTMLElement, initial: HeroAppearance, commit: (a: HeroAppearance) => void, opts: {
    start?: boolean;
    cancel?: () => void;
    visual?: HeroVisual;
} = {}) {
    stops.get(root)?.();
    root.replaceChildren();
    root.className = "character-editor";
    let a = sanitizeHeroAppearance(initial), state: HeroPose["state"] = "idle", mounted = false, alive = true, dress = false;
    const intro = document.createElement("header");
    intro.innerHTML = `<span class="eyebrow">YOUR STORY BEGINS HERE</span><h2>${opts.start ? "Create your character" : "Character creator"}</h2><p>Choose your appearance. Equipment and skills are earned in the world.</p>`;
    root.append(intro);
    const body = document.createElement("div");
    body.className = "creator-body";
    const preview = document.createElement("section");
    preview.className = "creator-preview";
    preview.setAttribute("aria-label", "Animated character preview");
    const cv = document.createElement("canvas");
    cv.width = 512;
    cv.height = 400;
    preview.append(cv);
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    preview.append(status);
    const actions = document.createElement("div");
    actions.className = "creator-poses";
    for (const pose of ["idle", "walk", "attack"] as const) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = pose[0].toUpperCase() + pose.slice(1);
        b.setAttribute("aria-pressed", String(pose === state));
        b.onclick = () => { state = pose; for (const ch of Array.from(actions.querySelectorAll("button")))
            ch.setAttribute("aria-pressed", String(ch === b)); };
        actions.append(b);
    }
    preview.append(actions);
    function checkbox(label: string, change: (v: boolean) => void) { const l = document.createElement("label"); const input = document.createElement("input"); input.type = "checkbox"; input.onchange = () => change(input.checked); l.append(input, document.createTextNode(label)); preview.append(l); return input; }
    checkbox("Mounted preview", v => mounted = v);
    checkbox("Preview equipment", v => dress = v);
    const gear = document.createElement("div");
    gear.className = "creator-gear";
    const weapon = document.createElement("select");
    weapon.setAttribute("aria-label", "Preview weapon");
    for (const w of PLAYER_WEAPON_KINDS) {
        const o = document.createElement("option");
        o.value = w;
        o.textContent = w[0].toUpperCase() + w.slice(1);
        weapon.append(o);
    }
    gear.append(weapon);
    const armour = document.createElement("select");
    armour.setAttribute("aria-label", "Preview armour tier");
    for (let i = 0; i <= 3; i++) {
        const o = document.createElement("option");
        o.value = String(i);
        o.textContent = i ? `Armour tier ${i}` : "No armour";
        armour.append(o);
    }
    armour.value = "1";
    gear.append(armour);
    preview.append(gear);
    const form = document.createElement("div");
    form.className = "creator-fields";
    const name = document.createElement("input");
    name.maxLength = 24;
    name.value = a.name;
    name.autocomplete = "off";
    name.oninput = () => a = { ...a, name: name.value };
    const nameLabel = document.createElement("label");
    nameLabel.append(document.createTextNode("Name"), name);
    form.append(nameLabel);
    const selectors = new Map<keyof HeroAppearance, HTMLSelectElement>();
    function field(key: keyof HeroAppearance, label: string, choices: string[], values?: string[]) { const l = document.createElement("label"); l.append(document.createTextNode(label)); const s = document.createElement("select"); s.setAttribute("aria-label", label); choices.forEach((text, i) => { const o = document.createElement("option"); o.value = values?.[i] ?? String(i); o.textContent = text; s.append(o); }); s.value = String(a[key]); s.onchange = () => { a = { ...a, [key]: values ? s.value : Number(s.value) }; }; l.append(s); form.append(l); selectors.set(key, s); }
    field("gender", "Body", ["Male", "Female"], ["m", "f"]);
    field("build", "Build", ["Slender · −7% height", "Average", "Broad · +7% height"]);
    field("face", "Face", ["Soft", "Strong", "Weathered / freckled"]);
    field("hair", "Hair", ["Bald", "Short", "Long", "Ponytail"]);
    field("hairColor", "Hair colour", ["Black", "Brown", "Blond", "Auburn", "Silver", "Light blond"]);
    field("skin", "Skin tone", ["Fair", "Warm", "Tan", "Brown", "Deep"]);
    field("horse", "Horse coat", HORSE_COATS.map(s => s[0].toUpperCase() + s.slice(1)), [...HORSE_COATS]);
    const random = document.createElement("button");
    random.type = "button";
    random.textContent = "Randomise appearance";
    random.onclick = () => { a = { ...a, gender: Math.random() < .5 ? "m" : "f", build: Math.floor(Math.random() * 3) as 0 | 1 | 2, face: Math.floor(Math.random() * 3), hair: Math.floor(Math.random() * 4), hairColor: Math.floor(Math.random() * 6), skin: Math.floor(Math.random() * 5), horse: HORSE_COATS[Math.floor(Math.random() * 5)] }; for (const [k, s] of selectors)
        s.value = String(a[k]); };
    form.append(random);
    body.append(preview, form);
    root.append(body);
    const footer = document.createElement("footer"), save = document.createElement("button");
    save.type = "button";
    save.className = "menu-btn";
    save.textContent = opts.start ? "Begin adventure" : "Save appearance";
    save.onclick = () => { a = sanitizeHeroAppearance(a); try {
        localStorage.setItem("sworn.creator", JSON.stringify(a));
    }
    catch { } commit(a); status.textContent = opts.start ? "Starting…" : "Appearance saved"; };
    footer.append(save);
    if (opts.cancel) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "menu-btn secondary";
        b.textContent = "Back";
        b.onclick = opts.cancel;
        footer.append(b);
    }
    root.append(footer);
    const note = document.createElement("p");
    note.className = "appearance-note";
    note.textContent = "Preview equipment does not grant items. A bow uses both hands. Matching armour sets use the new brown-haired male appearance and bay mount. Other appearance choices and mixed equipment retain their previous artwork.";
    root.append(note);
    const g = cv.getContext("2d")!;
    let raf = 0;
    const started = performance.now();
    function loop(now: number) {
        if (!alive || !root.isConnected)
            return;
        if (!root.getClientRects().length) {
            raf = requestAnimationFrame(loop);
            return;
        }
        const seconds = (now - started) / 1000, u = state === "attack" ? (seconds % 1.4) / 1.4 : seconds * (state === "walk" ? 1.15 : .35);
        const tier = dress ? Number(armour.value) : opts.visual?.armour ?? 0;
        const v: HeroVisual = { appearance: a, armour: tier, weapon: dress ? weapon.value : opts.visual?.weapon ?? "unarmed", weaponTier: dress ? Math.max(1, tier) : opts.visual?.weaponTier ?? 0, helmTier: dress ? tier : opts.visual?.helmTier ?? 0, shieldTier: 0, helmet: dress ? tier > 0 : opts.visual?.helmet ?? false, shield: dress ? false : opts.visual?.shield ?? false };
        const f = heroFrame(v, { state, phase: u }, mounted, true);
        const fallback = !f ? heroArt(v, mounted, Math.floor(u * 4) % 4, state === "attack") : undefined;
        g.clearRect(0, 0, 512, 400);
        g.fillStyle = "#b8b899";
        g.fillRect(0, 0, 512, 400);
        g.fillStyle = "#a3a987";
        g.fillRect(0, 330, 512, 70);
        if (f) {
            g.imageSmoothingEnabled = true;
            const scale = 2.3, x = 256 - 120 * scale, y = 330 - (mounted ? 211 : 163) * scale;
            g.drawImage(f.canvas, x, y, f.canvas.width * scale, f.canvas.height * scale);
            status.textContent = `${a.name || "Wanderer"} · ${mounted ? "Mounted" : "On foot"} · ${state}`;
        }
        else if (fallback) {
            const h = mounted ? 260 : 220, w = fallback.canvas.width * h / fallback.canvas.height;
            g.drawImage(fallback.canvas, 256 - w / 2, 330 - h, w, h);
            status.textContent = "Existing game art preview";
        }
        else
            status.textContent = heroRigReady() ? "This equipment uses the existing game art fallback" : "Loading painted parts…";
        raf = requestAnimationFrame(loop);
    }
    void loadHeroRig();
    void loadHeroAppearanceArt();
    raf = requestAnimationFrame(loop);
    stops.set(root, () => { alive = false; cancelAnimationFrame(raf); });
}
export function chooseCharacter(): Promise<HeroAppearance | null> {
    const overlay = document.createElement("div");
    overlay.id = "character-creator-modal";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Create your character");
    const root = document.createElement("div");
    overlay.append(root);
    document.body.append(overlay);
    let initial = DEFAULT_HERO_APPEARANCE;
    try {
        initial = sanitizeHeroAppearance(JSON.parse(localStorage.getItem("sworn.creator") ?? "null"));
    }
    catch { }
    return new Promise(resolve => { const close = (value: HeroAppearance | null) => { stops.get(root)?.(); overlay.remove(); document.removeEventListener("keydown", key); resolve(value); }; const key = (e: KeyboardEvent) => { if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(null);
    } if (e.key === "Tab") {
        const all = Array.from(overlay.querySelectorAll<HTMLElement>("button,input,select"));
        if (e.shiftKey && document.activeElement === all[0]) {
            e.preventDefault();
            all.at(-1)?.focus();
        }
        else if (!e.shiftKey && document.activeElement === all.at(-1)) {
            e.preventDefault();
            all[0]?.focus();
        }
    } }; document.addEventListener("keydown", key); renderCharacterEditor(root, initial, a => close(a), { start: true, cancel: () => close(null) }); root.querySelector<HTMLInputElement>(".creator-fields input")?.focus(); });
}
