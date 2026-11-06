// family.ts: family, marriage and succession (docs/colony2d/PLAN-family-and-succession.md; ROADMAP "Family —
// landed"). The hero is a person (HeroLife.family, saved with the hero profile): `selfId` is what other persons'
// `parents` / `spouse` point at. Children and siblings are derived from the living colonists. Dialogue for courtship
// and marriage lives in herolife.ts and calls the state changes here.
import { BLOOD_CLAIM_RELATION, CHILD_TALENT_SHARE, COURT_NEEDED, FEUD_DAYS, MARRIAGE_BREAK_RELATION, SPOUSE_DEATH_RELATION, HERO_BIRTH_CHANCE, HERO_BIRTH_COOLDOWN_DAYS, KIN_LABEL, MARRIAGE_RELATION_JUMP, NEED_MAX, type FamilyMemberSnapshot, type FamilySnapshot, type HeroFamilyData, type KinRelation } from "@colony/shared/herolife";
import type { Colonist, Player, SiteState } from "./types.js";
import { colonists, players, sites, state } from "./state.js";
import { GAME_DAY_TICKS, RELATION_ALLIED_MIN } from "./constants.js";
import { nearestTownCenter, newPerson, personAgeDays, queueRespawn, settlementOf, settlementStats, spawnVillager } from "./colonists.js";
import { clanById, withClan } from "./clans.js";
import { releaseResourceReservation } from "./economy.js";
import { leaveOrderGroup } from "./orders.js";
import { gameDay, standingTown } from "./diplomacy.js";
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

// The succession order (people.ts heirOrderNames, passed in to avoid an import cycle); for the panel's heir line.
export type HeirOrder = (p: Player) => { name: string; rel: KinRelation | null }[];

// Courtship flags in HeroLife.flags: "court:<key>" = points (key "c:<colonistId>" / "s:<siteId>").
export function courtNameOf(key: string): string {
  if (key.startsWith("c:")) return colonists.get(key.slice(2))?.person?.name ?? "someone";
  const s = sites.get(key.slice(2));
  return s ? `kin of ${s.name}` : "someone";
}

export function familySnapshot(p: Player, heirOrder: HeirOrder): FamilySnapshot {
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
export function updateFamily(heirOrder: HeirOrder) {
  for (const p of players.values()) {
    widowCheck(p);
    cache.set(p.id, familySnapshot(p, heirOrder));
  }
}

// The spouse is gone (died): widowed; an in-law settlement mourns and the marriage bond ends.
function widowCheck(p: Player) {
  const f = heroProfileOf(p).life?.family;
  if (!f?.spouse || spouseOf(p) || heroWithSelf(f.spouse)) return;
  const name = f.spouseName ?? "Your spouse";
  const s = f.spouseKin ? sites.get(f.spouseKin) : undefined;
  delete f.spouse;
  delete f.spouseName;
  delete f.spouseKin;
  withClan(clanById(p.clan ?? 0), () => {
    if (standingTown(s)) adjustRelation(p.clan ?? 0, s.id, SPOUSE_DEATH_RELATION);
    broadcastEvent("death", `${name} has died: ${heroName(p)} is widowed${standingTown(s) ? `; ${s.name} mourns (relation ${SPOUSE_DEATH_RELATION}) and the marriage bond ends` : ""}`);
  });
}

// "We should part ways" (run in the clan context): the marriage ends; an Elder's kin goes home and their settlement
// turns on you (relation MARRIAGE_BREAK_RELATION, no courtship there for FEUD_DAYS).
export function partWays(p: Player): string {
  const sp = spouseOf(p);
  const f = familyOf(p);
  if (!sp) return "You are not married";
  const s = sp.person!.kinOf ? sites.get(sp.person!.kinOf) : undefined;
  delete sp.person!.spouse;
  delete f.spouse;
  delete f.spouseName;
  delete f.spouseKin;
  if (s) {
    releaseResourceReservation(sp);
    leaveOrderGroup(sp.id);
    if (sp.kind !== "villager") queueRespawn(sp);
    colonists.delete(sp.id);
    const flags = heroProfileOf(p).life?.flags;
    if (flags) flags[`feud:${s.id}`] = gameDay() + FEUD_DAYS;
    if (standingTown(s)) adjustRelation(p.clan ?? 0, s.id, MARRIAGE_BREAK_RELATION);
  }
  const text = `${heroName(p)} and ${sp.person!.name} part ways${s ? `: ${sp.person!.name} goes home to ${s.name}, and ${s.name} will not forget it (relation ${MARRIAGE_BREAK_RELATION}, a feud)` : ""}`;
  broadcastEvent(s ? "raid" : "build", text);
  return text;
}

// people.ts handleChooseHeir: the heir becomes the family's new self (their parents and spouse carry over; the old
// hero's other children become siblings). A child of an in-law marriage taking over: that settlement's blood claim.
export function succeedFamily(p: Player, c: Colonist) {
  const old = familyOf(p);
  const life = heroProfileOf(p).life!;
  const clan = p.clan ?? 0;
  const claims = new Set<string>();
  if (c.person?.parents?.includes(old.selfId)) {
    if (old.kinOf) claims.add(old.kinOf);
    for (const id of c.person.parents) {
      const k = colonists.get(id)?.person?.kinOf;
      if (k) claims.add(k);
    }
  }
  const spouse = c.person?.spouse && c.person.spouse !== old.selfId ? colonists.get(c.person.spouse) : undefined;
  const next: HeroFamilyData = { selfId: c.id, gen: old.gen + 1, name: c.person?.name ?? c.heroName ?? "The heir" };
  if (c.person?.parents?.length) next.parents = [...c.person.parents];
  if (spouse?.person?.spouse === c.id) {
    next.spouse = spouse.id;
    next.spouseName = spouse.person.name;
    if (spouse.person.kinOf) next.spouseKin = spouse.person.kinOf;
  }
  if (c.person?.kinOf) next.kinOf = c.person.kinOf;
  life.family = next;
  for (const k of Object.keys(life.flags)) if (k.startsWith("court")) delete life.flags[k];
  for (const id of claims) {
    const s = sites.get(id);
    if (!standingTown(s)) continue;
    adjustRelation(clan, s.id, BLOOD_CLAIM_RELATION);
    broadcastEvent("milestone", `${next.name} carries the blood of ${s.name}: they rejoice (relation +${BLOOD_CLAIM_RELATION})`);
  }
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
  if (s) f.spouseKin = s.id;
  else delete f.spouseKin;
  const flags = heroProfileOf(p).life?.flags;
  if (flags) for (const k of Object.keys(flags)) if (k.startsWith("court")) delete flags[k];
  if (s) {
    c.person!.kinOf = s.id;
    const clan = p.clan ?? 0;
    adjustRelation(clan, s.id, Math.max(MARRIAGE_RELATION_JUMP, RELATION_ALLIED_MIN - relationOf(clan, s.id)));
  }
  broadcastEvent("milestone", `${heroName(p)} and ${c.person!.name} are wed${s ? `: ${s.name} is bound to you by marriage` : ""}`);
}

// A child of the hero and the spouse (run in the clan context), at the spouse's settlement: a newborn villager
// (village-life aging) with a share of the hero's skills as talent and of the spouse's profession XP.
export function heroChild(p: Player, sp: Colonist): Colonist | null {
  const tc = settlementOf(sp) ?? nearestTownCenter(p.x, p.y, state.townCenters.filter((t) => (t.clan ?? 0) === (p.clan ?? 0)));
  if (!tc) return null;
  const f = familyOf(p);
  const person = newPerson("born", state.cycleTick);
  person.child = true;
  person.parents = [f.selfId, sp.id];
  const talent: Record<string, number> = {};
  for (const [k, v] of Object.entries(heroProfileOf(p).life?.skills ?? {})) if (v && v > 0) talent[k] = Math.floor(v * CHILD_TALENT_SHARE);
  if (Object.keys(talent).length) person.talent = talent;
  const xp: Record<string, number> = {};
  for (const [k, v] of Object.entries(sp.person?.xp ?? {})) if (v && v > 0) xp[k] = Math.floor(v * CHILD_TALENT_SHARE);
  if (Object.keys(xp).length) person.xp = xp;
  f.lastBirthTick = state.cycleTick;
  const c = spawnVillager(tc, person);
  broadcastEvent("milestone", `A child is born to ${heroName(p)} and ${sp.person!.name}: ${person.name}`);
  return c;
}

// people.ts dawn pass (clan context): the hero couple may have a child (`force` skips the dice and cooldown).
export function heroBirthsDawn(force = false) {
  for (const p of players.values()) {
    if ((p.clan ?? 0) !== state.clan.id || p.dead) continue;
    const sp = spouseOf(p);
    if (!sp || sp.person!.child) continue;
    const f = familyOf(p);
    if (!force && f.lastBirthTick !== undefined && state.cycleTick - f.lastBirthTick < HERO_BIRTH_COOLDOWN_DAYS * GAME_DAY_TICKS) continue;
    if (!force && Math.random() >= HERO_BIRTH_CHANCE) continue;
    const st = settlementStats().find((x) => x.tc === settlementOf(sp));
    if (st && st.used >= st.cap && !state.creative && !force) continue;
    heroChild(p, sp);
  }
}

// Creative: an instant spouse (a new adult at the nearest Town Center) and / or newborn children of the couple.
export function creativeFamily(p: Player, spouse: boolean, children: number): { ok: boolean; text: string; ids: string[] } {
  const ids: string[] = [];
  let sp = spouseOf(p);
  if (!sp && (spouse || children > 0)) {
    const tc = nearestTownCenter(p.x, p.y, state.townCenters.filter((t) => (t.clan ?? 0) === (p.clan ?? 0)));
    if (!tc) return { ok: false, text: "No Town Center of yours", ids };
    sp = spawnVillager(tc, newPerson("immigrant"));
    marry(p, sp);
    ids.push(sp.id);
  }
  for (let i = 0; sp && i < children; i++) {
    const c = heroChild(p, sp);
    if (c) ids.push(c.id);
  }
  return { ok: true, text: `Family: spouse ${sp?.person?.name ?? "none"}, ${children} child(ren) born`, ids };
}
