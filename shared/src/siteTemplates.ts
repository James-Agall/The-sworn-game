// siteTemplates.ts: the NPC fort / human-site templates (bandit Palisade, orc Stockade, and the human behaviour
// profiles Hearthmoor / Ironhold / Riverwatch that settlement templates point at with `profile`). Shared by the server
// (store + stamper: server/src/siteTemplates.ts, sites.ts) and the Sprite Lab's editor. Built-ins live in
// server/data/sites/<id>.json (read-only), the editors' saves in server/data/sites/user/*.json; both load at boot.
// A template is an ASCII grid at its MAX tier (legend SITE_TEMPLATE_TILES, a human template's own `symbols` on top)
// plus a same-size `tiers` grid giving the tier (digit 1-4) each non-"." cell joins at; below it a gate is a wall
// while the wall ring stands (tier 2+), a wall a fence (the tier-1 camp), anything else open. Exactly one keep "K"
// (the site's hearth). In the JSON file `symbols` maps a symbol to a TileType NAME ("StoneWall"); the server turns it
// into the TileType number (siteTemplateFromFile).
import { TileType, type SiteFaction } from "./protocol.js";

// Legend of the fort templates: # wood wall, G gate, T tower, K keep / chief hall (the site's hearth), H tent,
// C campfire, s stockpile crate, p pen fence, f farm plot (decor: no barn), F forge (cart placeholder), M ore heap
// (barrel placeholder), ~ moat (phase H: a real Moat tile), D drawbridge (phase H: a site gate on the moat), "." open
// ground (left Empty and unowned, inside the reserved grounds). Every stamped (non-".") cell is owned by the site.
export const SITE_TEMPLATE_TILES: Record<string, TileType> = {
  "#": TileType.Wall,
  G: TileType.Gate,
  T: TileType.Tower,
  K: TileType.SiteKeep,
  H: TileType.Tent,
  C: TileType.PropCampfire,
  s: TileType.PropCrate,
  p: TileType.PropFence,
  f: TileType.FarmPlot,
  F: TileType.PropCart,
  // Ore heap decor (not real IronOre: colonists' resource searches would try to reach it inside the walls).
  M: TileType.PropBarrel,
  "~": TileType.Moat,
  D: TileType.Drawbridge,
};
// Forts phase C: human settlement symbols (the human templates' `symbols`, over SITE_TEMPLATE_TILES): stone walls,
// houses, a forge (Blacksmith), real ore / rock (inside the reserved grounds: no player mine can go there), a well
// (one Water tile), barn, market, church, inn (Tavern), mill (BigHouse). The player-building tiles are inert while the
// site owns them (no workers; housing skips NPC tiles) and real after a capture.
export const HUMAN_SITE_SYMBOLS: Record<string, TileType> = {
  "#": TileType.StoneWall,
  H: TileType.House,
  F: TileType.Blacksmith,
  M: TileType.IronOre,
  R: TileType.Rock,
  W: TileType.Water,
  B: TileType.BarnPost,
  m: TileType.Market,
  c: TileType.ChurchPost,
  i: TileType.Tavern,
  n: TileType.BigHouse,
};

export const SITE_FACTIONS: readonly SiteFaction[] = ["bandit", "orc", "human"];
export const SITE_WORKER_ROLES = ["farm", "mine", "priest", "herald"] as const;
// The colony's stock keys (server ResourceKey) a template's stock / rebuild cost may use.
export const SITE_RESOURCE_KEYS = ["wood", "iron", "rock", "grain", "meat", "fruit", "wool", "cotton", "clothes", "tools", "luxuryItems", "gold", "alcohol"] as const;
// Keep HP exists for tiers 1-4 (server SITE_KEEP_HP_BY_TIER).
export const SITE_MAX_TIER = 4;
export const SITE_SIZE_MAX = 64;

// The file format (server/data/sites/<id>.json). Field order is the order the store writes.
export interface SiteTemplateFile {
  id: string;
  faction: SiteFaction;
  // "Palisade" / "Stockade": the site name is "<picked name> <label>" ("" for the human profiles).
  label: string;
  // The sighting toast's noun ("village", "mining outpost", "town").
  noun?: string;
  names: string[];
  rows: string[];
  tiers: string[];
  maxTier: number;
  startTier: number;
  // Symbol -> TileType name, over SITE_TEMPLATE_TILES.
  symbols?: Record<string, string>;
  // Garrison at the start tier (mob kind -> count), in spawn order.
  garrison: Record<string, number>;
  // Cosmetic workers (role -> count), spawned while awake.
  workers?: Record<string, number>;
  // Starting stockpile and the rebuild-the-keep cost (resource -> amount).
  stock: Record<string, number>;
  rebuildCost: Record<string, number>;
  // Set by the server on lists it sends: a built-in (read-only) or a user template.
  builtin?: boolean;
}

// The template as the game uses it: `symbols` as TileType numbers.
export type SiteTemplateData = Omit<SiteTemplateFile, "symbols" | "builtin"> & { symbols?: Record<string, TileType> };

const tileByName = (name: unknown): TileType | undefined =>
  typeof name === "string" && Object.prototype.hasOwnProperty.call(TileType, name) && typeof (TileType as unknown as Record<string, unknown>)[name] === "number"
    ? (TileType as unknown as Record<string, TileType>)[name]
    : undefined;

// TileType number -> its name (for writing a file from a runtime table).
export function siteTileName(tile: TileType): string {
  return TileType[tile];
}

// Only the known fields, in the file's field order (a hand-edited file may carry notes).
export function normaliseSiteTemplateFile(o: SiteTemplateFile): SiteTemplateFile {
  return {
    id: o.id, faction: o.faction, label: o.label, ...(o.noun !== undefined ? { noun: o.noun } : {}), names: o.names.slice(),
    rows: o.rows.slice(), tiers: o.tiers.slice(), maxTier: o.maxTier, startTier: o.startTier,
    ...(o.symbols ? { symbols: { ...o.symbols } } : {}), garrison: { ...o.garrison }, ...(o.workers ? { workers: { ...o.workers } } : {}),
    stock: { ...o.stock }, rebuildCost: { ...o.rebuildCost },
  };
}

// The game's form of a (validated) file: symbol names -> TileType numbers; every other field copied as is.
export function siteTemplateFromFile(o: SiteTemplateFile): SiteTemplateData {
  const n = normaliseSiteTemplateFile(o);
  const symbols = n.symbols ? Object.fromEntries(Object.entries(n.symbols).map(([c, name]) => [c, tileByName(name)!])) : undefined;
  return { ...n, ...(symbols ? { symbols } : {}) } as SiteTemplateData;
}

const countMap = (v: unknown, what: string, keys: readonly string[] | undefined, errs: string[], allowEmpty = true) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return void errs.push(`${what}: an object of name -> number`);
  const entries = Object.entries(v as Record<string, unknown>);
  if (!allowEmpty && entries.length === 0) errs.push(`${what}: at least one entry`);
  for (const [k, n] of entries) {
    if (keys && !keys.includes(k)) errs.push(`${what}: unknown "${k}"`);
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 10000) errs.push(`${what}.${k}: a whole number 0-10000`);
  }
};

// Every problem with a template file (empty: valid). `mobKinds`: the server's mob kinds (garrison keys); without it
// any name is accepted there. Checks the metadata, the grid shape, the legend (+ own symbols), one keep "K", a tier
// digit 1..maxTier on every non-"." cell and "." in `tiers` on every "." cell.
export function validateSiteTemplate(raw: unknown, opts: { mobKinds?: readonly string[] } = {}): string[] {
  const errs: string[] = [];
  const o = raw as Partial<SiteTemplateFile> | null;
  if (!o || typeof o !== "object" || Array.isArray(o)) return ["not an object"];
  if (typeof o.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(o.id)) errs.push("id: 1-48 of a-z 0-9 - _ (starting with a letter / digit)");
  if (!SITE_FACTIONS.includes(o.faction as SiteFaction)) errs.push(`faction: one of ${SITE_FACTIONS.join(", ")}`);
  if (typeof o.label !== "string" || o.label.length > 40) errs.push("label: 0-40 characters");
  if (o.noun !== undefined && (typeof o.noun !== "string" || o.noun.trim().length === 0 || o.noun.length > 40)) errs.push("noun: 1-40 characters");
  if (!Array.isArray(o.names) || o.names.length === 0 || o.names.some((n) => typeof n !== "string" || n.trim().length === 0 || n.length > 40)) errs.push("names: a list of 1-40 character names");
  if (!Number.isInteger(o.maxTier) || o.maxTier! < 1 || o.maxTier! > SITE_MAX_TIER) errs.push(`maxTier: 1-${SITE_MAX_TIER}`);
  if (!Number.isInteger(o.startTier) || o.startTier! < 1 || o.startTier! > (o.maxTier ?? 0)) errs.push("startTier: 1..maxTier");
  countMap(o.garrison, "garrison", opts.mobKinds, errs, false);
  if (o.workers !== undefined) countMap(o.workers, "workers", SITE_WORKER_ROLES, errs);
  countMap(o.stock, "stock", SITE_RESOURCE_KEYS, errs);
  countMap(o.rebuildCost, "rebuildCost", SITE_RESOURCE_KEYS, errs);
  let symbols: Record<string, TileType> = {};
  if (o.symbols !== undefined) {
    if (!o.symbols || typeof o.symbols !== "object" || Array.isArray(o.symbols)) errs.push("symbols: an object of symbol -> TileType name");
    else for (const [c, name] of Object.entries(o.symbols)) {
      if ([...c].length !== 1 || c === ".") errs.push(`symbols: "${c}" is not one symbol character (other than ".")`);
      const tile = tileByName(name);
      if (tile === undefined) errs.push(`symbols.${c}: unknown tile "${String(name)}"`);
      else symbols[c] = tile;
    }
  }
  const rows = o.rows;
  const tiers = o.tiers;
  if (!Array.isArray(rows) || rows.length === 0 || rows.some((r) => typeof r !== "string")) return [...errs, "rows: a list of strings"];
  if (!Array.isArray(tiers) || tiers.some((r) => typeof r !== "string")) return [...errs, "tiers: a list of strings"];
  const h = rows.length;
  const w = rows[0].length;
  if (w === 0 || w > SITE_SIZE_MAX || h > SITE_SIZE_MAX) errs.push(`size: 1-${SITE_SIZE_MAX} each way (is ${w}x${h})`);
  if (tiers.length !== h) errs.push(`tiers: ${tiers.length} rows, not ${h}`);
  let keeps = 0;
  for (let y = 0; y < h; y++) {
    if (rows[y].length !== w) {
      errs.push(`row ${y}: ${rows[y].length} wide, not ${w}`);
      continue;
    }
    if (tiers[y] !== undefined && tiers[y].length !== w) {
      errs.push(`tiers row ${y}: ${tiers[y].length} wide, not ${w}`);
      continue;
    }
    for (let x = 0; x < w; x++) {
      const c = rows[y][x];
      const t = tiers[y]?.[x];
      if (c === ".") {
        if (t !== undefined && t !== ".") errs.push(`tiers: "." expected at ${x},${y} (open ground)`);
        continue;
      }
      if ((symbols[c] ?? SITE_TEMPLATE_TILES[c]) === undefined) errs.push(`unknown symbol "${c}" at ${x},${y}`);
      const tier = Number(t);
      if (!(Number.isInteger(tier) && tier >= 1 && tier <= (o.maxTier ?? 0))) errs.push(`tiers: no tier 1..maxTier at ${x},${y}`);
      if (c === "K") keeps++;
    }
  }
  if (keeps !== 1) errs.push(`exactly one keep K (has ${keeps})`);
  return errs;
}
