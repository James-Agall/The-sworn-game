// family.ts: family, marriage and succession (docs/colony2d/PLAN-family-and-succession.md; ROADMAP "Family —
// landed"). The hero is a person (HeroLife.family, saved with the hero profile): `selfId` is what other persons'
// `parents` / `spouse` point at. Children and siblings are derived from the living colonists. Dialogue for courtship
// and marriage lives in herolife.ts and calls the state changes here.
import { COURT_NEEDED, KIN_LABEL, NEED_MAX, type FamilyMemberSnapshot, type FamilySnapshot, type HeroFamilyData, type KinRelation } from "@colony/shared/herolife";
import type { Colonist, Player } from "./types.js";
import { colonists, players, sites } from "./state.js";
import { personAgeDays } from "./colonists.js";
import { heroProfileOf } from "./heroes.js";

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
