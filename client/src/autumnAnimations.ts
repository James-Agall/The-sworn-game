import { Assets, Texture } from "pixi.js";

// Optional art: one missing sheet must never prevent the game from loading.
const sheets: Record<string, { rows: string[]; cols: number }> = {
  "animal-walks-a": { rows: ["hen", "rooster", "chick", "cow", "calf"], cols: 12 },
  "animal-walks-b": { rows: ["pig", "piglet", "woolly-sheep", "shorn-sheep", "lamb"], cols: 12 },
  "animal-walks-c": { rows: ["horse", "foal", "dog", "cat"], cols: 12 },
  "human-tasks-directions-a": { rows: ["sow", "water", "harvest", "haul"], cols: 12 },
  "human-tasks-directions-b": { rows: ["build", "chop", "mine", "cook"], cols: 12 },
  "human-life-directions": { rows: ["eat", "sit", "sleep", "carry-loads"], cols: 12 },
  "hero-tool-actions": { rows: ["axe", "pickaxe", "hoe", "scythe", "watering-can"], cols: 12 },
  heroes: { rows: ["base", "champion", "marksman", "mage"], cols: 10 },
  "mounted-units-v2": { rows: ["cavalry-t1", "cavalry-t2", "cavalry-t3", "mounted-player"], cols: 10 },
  "civic-buildings": { rows: ["cottage", "townhall", "tavern", "church", "market", "hospital"], cols: 8 },
  "production-buildings": { rows: ["lumber", "mine", "smith", "bakery-mill", "tailor", "brewery"], cols: 8 },
  "military-animal-buildings": { rows: ["barracks", "range-tower", "castle", "stable", "barn-coop", "sty-pen"], cols: 8 },
  "specialist-building-tiers": { rows: ["hunter-hut", "forager-hut", "builders-guild", "jeweller"], cols: 12 },
  "animal-building-states": { rows: ["coop", "cow-barn", "pigsty", "sheep-pen", "stable", "kennel"], cols: 8 },
  "interior-walls": { rows: ["interior-timber-00-07", "interior-timber-08-15", "plaster-00-07", "plaster-08-15", "dressed-stone-00-07", "dressed-stone-08-15", "brick-00-07", "brick-08-15"], cols: 8 },
  "furniture-stations": { rows: ["beds-seating", "storage", "hearth-light-altar", "workstations", "supplies", "stairs-signs"], cols: 8 },
  "terrain-connections": { rows: ["dirt-road-00-07", "dirt-road-08-15", "cobble-road-00-07", "cobble-road-08-15", "moat-00-07", "moat-08-15", "shore-00-07", "shore-08-15"], cols: 8 },
  "village-life": { rows: ["adult-man", "adult-woman", "child", "elder", "captive"], cols: 10 },
};
const textures = new Map<string, Texture>();
const pending = new Map<string, Promise<void>>();
const key = (sheet: string, row: number, column: number) => `${sheet}/${row}/${column}`;
export function autumnFrame(sheet: string, row: number, column: number): Texture | undefined {
  return textures.get(key(sheet, row, column));
}
export function loadAutumnSheet(sheet: string): Promise<void> {
  const existing = pending.get(sheet);
  if (existing) return existing;
  const spec = sheets[sheet];
  if (!spec) return Promise.resolve();
  const jobs = spec.rows.flatMap((name, row) => Array.from({ length: spec.cols }, (_, column) => ({ name, row, column })));
  const promise = Promise.all(Array.from({ length: 8 }, async () => {
    while (jobs.length) {
      const job = jobs.pop()!;
      try {
        const url = `/sprites/autumn/frames/${sheet}/${job.name}-${String(job.column + 1).padStart(2, "0")}.png`;
        const texture = await Assets.load<Texture>(url);
        texture.source.scaleMode = "nearest";
        textures.set(key(sheet, job.row, job.column), texture);
      } catch { /* Existing sprites remain the fallback. */ }
    }
  })).then(() => undefined);
  pending.set(sheet, promise);
  return promise;
}
export const loadAutumnPeople = () => Promise.all([
  "human-tasks-directions-a", "human-tasks-directions-b", "human-life-directions", "hero-tool-actions", "heroes", "village-life", "mounted-units-v2", "interior-walls", "furniture-stations",
].map(loadAutumnSheet));

export type Cardinal = "e" | "w" | "n" | "s";
export function movementFacing(dx: number, dy: number, previous: Cardinal = "e"): Cardinal {
  if (Math.hypot(dx, dy) < 0.3) return previous;
  return Math.abs(dy) > Math.abs(dx) ? (dy < 0 ? "n" : "s") : dx < 0 ? "w" : "e";
}
export function directionalFrame(sheet: string, row: number, facing: Cardinal, frame: number): Texture | undefined {
  // Life sheet's observed order is E,S,N; the other directional sheets are E,N,S.
  const north = sheet === "human-life-directions" ? 8 : 4;
  const south = sheet === "human-life-directions" ? 4 : 8;
  return autumnFrame(sheet, row, (facing === "n" ? north : facing === "s" ? south : 0) + frame % 4);
}
