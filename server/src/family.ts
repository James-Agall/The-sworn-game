// family.ts: family, marriage and succession (docs/colony2d/PLAN-family-and-succession.md; ROADMAP "Family —
// landed"). The hero is a person (HeroLife.family, saved with the hero profile): `selfId` is what other persons'
// `parents` / `spouse` point at. Children and siblings are derived from the living colonists. Dialogue for courtship
// and marriage lives in herolife.ts and calls the state changes here.
import { COURT_NEEDED, KIN_LABEL, MARRIAGE_RELATION_JUMP, NEED_MAX, type FamilyMemberSnapshot, type FamilySnapshot, type HeroFamilyData, type KinRelation } from "@colony/shared/herolife";
import type { Colonist, Player, SiteState } from "./types.js";
import { colonists, players, sites, state } from "./state.js";
import { RELATION_ALLIED_MIN } from "./constants.js";
import { nearestTownCenter, newPerson, personAgeDays, spawnVillager } from "./colonists.js";
import { heroProfileOf } from "./heroes.js";
import { adjustRelation, relationOf } from "./sites.js";
import { broadcastEvent } from "./net.js";

export function familyOf(p: Player): HeroFamilyData {
  const prof = heroProfileOf(p);
  const life = (prof.life ??= { pack: {}, food: NEED_MAX, rest: NEED_MAX, skills: {}, flags: {}, builds: [] });
  return (life.family ??= { selfId: `hero-${prof.key}-1`, gen: 1 });
}

const living = (id: string | undefined, clan: number): Colonist | undefined => {
  const c = id ? colonists.get(id) : undefined;
  return c && c.person && c.hp > 0 && (c.clan ?? 0) === clan ? c : undefined;
};

// The hero's spouse as a living colonist of the clan (married both ways).
export function spouseOf(p: Player): Colonist | undefined {
  const f = familyOf(p);
  const c = living(f.spouse, p.clan ?? 0);
  return c && c.person!.spouse === f.selfId ? c : undefined;
}

export function childrenOf(p: Player): Colonist[] {
  const self = familyOf(p).selfId;
  return Array.from(colonists.values()).filter((c) => c.person?.parents?.includes(self) && c.hp > 0 && (c.clan ?? 0) === (p.clan ?? 0));
}

export function siblingsOf(p: Player): Colonist[] {
  const par = familyOf(p).parents ?? [];
  if (par.length === 0) return [];
  return Array.from(colonists.values()).filter((c) => c.hp > 0 && (c.clan ?? 0) === (p.clan ?? 0) && c.person?.parents?.some((x) => par.includes(x)));
}

export function parentsOf(p: Player): Colonist[] {
  return (familyOf(p).parents ?? []).map((id) => living(id, p.clan ?? 0)).filter((c): c is Colonist => !!c);
}

// How a colonist is related to the hero (null: not close kin).
export function kinRelation(p: Player, c: Colonist): KinRelation | null {
  const f = familyOf(p);
  if (!c.person) return null;
  if (f.spouse === c.id && c.person.spouse === f.selfId) return "spouse";
  if (c.person.parents?.includes(f.selfId)) return "child";
  if (f.parents?.includes(c.id)) return "parent";
  if (f.parents?.length && c.person.parents?.some((x) => f.parents!.includes(x))) return "sibling";
  return null;
}

// The player whose hero has this selfId (a spouse / parent that is a hero, not a colonist).
export function heroWithSelf(id: string | undefined): Player | undefined {
  if (!id) return undefined;
  for (const p of players.values()) if (heroProfileOf(p).life?.family?.selfId === id) return p;
  return undefined;
}

const member = (c: Colonist): FamilyMemberSnapshot => ({
  id: c.id,
  name: c.person!.name,
  ageDays: Math.floor(personAgeDays(c.person!)),
  ...(c.person!.child ? { child: true } : {}),
  ...(c.person!.kinOf && sites.get(c.person!.kinOf) ? { from: sites.get(c.person!.kinOf)!.name } : {}),
});

// Succession order hook (people.ts heirChoicesFor sets it); here only for the panel's heir line.
let heirOrder: (p: Player) => { name: string; rel: KinRelation | null }[] = () => [];
export function setHeirOrderSource(fn: typeof heirOrder) {
  heirOrder = fn;
}

// Courtship flags in HeroLife.flags: "court:<key>" = points (key "c:<colonistId>" / "s:<siteId>").
export function courtNameOf(key: string): string {
  if (key.startsWith("c:")) return colonists.get(key.slice(2))?.person?.name ?? "someone";
  const s = sites.get(key.slice(2));
  return s ? `kin of ${s.name}` : "someone";
}

export function familySnapshot(p: Player): FamilySnapshot {
  const f = familyOf(p);
  const flags = heroProfileOf(p).life?.flags ?? {};
  const sp = spouseOf(p);
  const courting = Object.entries(flags)
    .filter(([k, v]) => k.startsWith("court:") && v > 0 && k.slice(6) !== f.betrothed?.key)
    .map(([k, v]) => ({ name: courtNameOf(k.slice(6)), points: v, need: COURT_NEEDED }))
    .slice(0, 6);
  return {
    name: f.name ?? "You",
    gen: f.gen,
    ...(sp ? { spouse: member(sp) } : {}),
    ...(f.betrothed ? { betrothed: f.betrothed.name } : {}),
    courting,
    children: childrenOf(p).sort((a, b) => a.person!.born - b.person!.born).map(member),
    parents: parentsOf(p).map(member),
    siblings: siblingsOf(p).map(member),
    heirs: heirOrder(p).slice(0, 4).map((h) => (h.rel ? `${h.name} (${KIN_LABEL[h.rel].toLowerCase()})` : h.name)),
  };
}

// Recomputed once a second (sim.ts) so the per-tick life snapshot only reads it.
const cache = new Map<string, FamilySnapshot>();
export function cachedFamilySnapshot(p: Player): FamilySnapshot | undefined {
  return cache.get(p.id);
}
export function updateFamily() {
  for (const p of players.values()) cache.set(p.id, familySnapshot(p));
}
export function resetFamilyCache() {
  cache.clear();
}

export const heroName = (p: Player) => familyOf(p).name ?? "The hero";

// A diplomatic marriage binds the settlement to the clan while the in-law spouse lives in it (or took over as hero).
export function kinBond(s: SiteState, clanId: number): boolean {
  for (const c of colonists.values()) if (c.person?.kinOf === s.id && c.person.spouse && c.hp > 0 && (c.clan ?? 0) === clanId) return true;
  for (const p of players.values()) if ((p.clan ?? 0) === clanId && heroProfileOf(p).life?.family?.kinOf === s.id) return true;
  return false;
}

// Can the hero court this colonist: an unmarried adult of the clan, not close kin, not a companion hero / trainee.
export function courtable(p: Player, c: Colonist): boolean {
  return !!c.person && !c.person.child && !c.person.spouse && c.kind !== "hero" && !c.training && !c.levyOf && (c.clan ?? 0) === (p.clan ?? 0) && c.hp > 0 && !kinRelation(p, c);
}

// Married or betrothed (to a living spouse): no more courting.
export function heroTaken(p: Player): boolean {
  return !!spouseOf(p) || !!familyOf(p).betrothed;
}

// An Elder's kin moves to the clan's Town Center nearest the hero (run in the clan context). Null: no Town Center.
export function bringKinHome(p: Player, name: string): Colonist | null {
  const tc = nearestTownCenter(p.x, p.y, state.townCenters.filter((t) => (t.clan ?? 0) === (p.clan ?? 0)));
  if (!tc) return null;
  const person = newPerson("immigrant");
  person.name = name;
  return spawnVillager(tc, person);
}

// The wedding (run in the clan context): both sides point at each other; an Elder's kin binds their settlement.
export function marry(p: Player, c: Colonist, s?: SiteState) {
  const f = familyOf(p);
  f.spouse = c.id;
  f.spouseName = c.person!.name;
  delete f.betrothed;
  c.person!.spouse = f.selfId;
  const flags = heroProfileOf(p).life?.flags;
  if (flags) for (const k of Object.keys(flags)) if (k.startsWith("court")) delete flags[k];
  if (s) {
    c.person!.kinOf = s.id;
    const clan = p.clan ?? 0;
    adjustRelation(clan, s.id, Math.max(MARRIAGE_RELATION_JUMP, RELATION_ALLIED_MIN - relationOf(clan, s.id)));
  }
  broadcastEvent("milestone", `${heroName(p)} and ${c.person!.name} are wed${s ? `: ${s.name} is bound to you by marriage` : ""}`);
}
