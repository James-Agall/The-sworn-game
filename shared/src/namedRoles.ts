// namedRoles.ts: a human settlement's named people (QUEUE G7 "a real quest-giver role with its own dialogue / quests";
// QUEUE "named-role dialogue"). Each settlement has one Elder, one merchant, one priest, one smith (when it has a forge)
// and one captain of the watch (when it has a garrison). A named person is the SAME person indoors and out: one name
// per settlement and role (`namedRoleName`), wherever their sprite stands (the market, the chapel, the forge, the
// barracks, at the gate). Every role but the Elder (who keeps the settlement's own board) asks for its own kind of
// help (`ROLE_QUESTS`: a smith wants iron, the captain wants a camp burned) and, once you have done them a service,
// offers a favour of its own once a game day (`ROLE_PERKS`). Pure data and pure helpers, shared by the server
// (herolife.ts / quests.ts / interiors.ts) and the tests.
import type { QuestKind, TradeGood } from "./protocol.js";

export type NamedRole = "elder" | "trader" | "priest" | "smith" | "captain";
export const NAMED_ROLES: NamedRole[] = ["elder", "trader", "priest", "smith", "captain"];
// The roles that post their own quests (the Elder keeps the settlement's board instead).
export type QuestRole = Exclude<NamedRole, "elder">;
export const QUEST_ROLES: QuestRole[] = ["trader", "priest", "smith", "captain"];

// ---- names (stable per NPC id; the server's nameFor) ----
const NAMES = ["Aldric", "Bryn", "Cedda", "Dunstan", "Edith", "Godric", "Hilda", "Ivo", "Maud", "Osric", "Rowena", "Sigrid", "Tamsin", "Wulf", "Agnes", "Bertram"];
export function nameHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
export const nameFor = (id: string) => NAMES[nameHash(id) % NAMES.length];

// Title before the name, and the dialogue panel's role label.
export const NAMED_ROLE_TITLE: Record<NamedRole, string> = { elder: "Elder", trader: "Merchant", priest: "Brother", smith: "Smith", captain: "Captain" };
export const NAMED_ROLE_LABEL: Record<NamedRole, string> = { elder: "Elder", trader: "Merchant", priest: "Priest", smith: "Smith", captain: "Captain of the watch" };
// Where they are found, for the Elder's "Who's who" ("... at the market").
export const NAMED_ROLE_PLACE: Record<NamedRole, string> = {
  elder: "keeps the hall and the peace",
  trader: "keeps the stalls; you'll find them about the market",
  priest: "tends the chapel and the sick",
  smith: "works the forge; follow the hammering",
  captain: "commands the watch; ask any guard",
};

// "Elder Aldric", "Smith Hilda": one per settlement and role. (The Elder's name hashes the bare site id, as it always has.)
export function namedRoleName(siteId: string, role: NamedRole): string {
  return `${NAMED_ROLE_TITLE[role]} ${nameFor(role === "elder" ? siteId : `${siteId}:${role}`)}`;
}

// ---- their quests ----
export interface RoleQuestDef {
  // What they ask for: deliver quests pick one of `goods` (one the settlement is short of first); the captain asks for
  // a camp burned (and, at night, the walls defended).
  kinds: QuestKind[];
  goods: TradeGood[];
  // "As it happens..." when a quest is posted; "nothing" when they have none (no camp near, ...); "later" on cooldown.
  ask: string;
  nothing: string;
  later: string;
  // Prefix of the quest title in the Quests panel ("Smith Hilda: Deliver 20 iron to Ashford").
  why: string;
}
export const ROLE_QUESTS: Record<QuestRole, RoleQuestDef> = {
  trader: {
    kinds: ["deliver"], goods: ["wool", "clothes", "fruit", "meat"],
    ask: "\"A buyer upriver wants more than I have on the cart. Bring me the goods and I'll pay you fair, and then some.\"",
    nothing: "\"Trade's slow. I've nothing I need fetching.\"",
    later: "\"I've no new orders yet. Come back in a day or so.\"",
    why: "for the market",
  },
  priest: {
    kinds: ["deliver"], goods: ["grain", "fruit", "clothes"],
    ask: "\"The poor of {site} are hungry and cold. Alms in kind, friend: the Saint sees what we give.\"",
    nothing: "\"The alms box is full, thank the Saint. Nothing is needed.\"",
    later: "\"You have given enough for now. Come back another day.\"",
    why: "alms for the poor",
  },
  smith: {
    kinds: ["deliver"], goods: ["iron", "wood", "rock"],
    ask: "\"The forge eats iron and charcoal faster than the carts bring it. Fetch me some and I'll not forget it.\"",
    nothing: "\"The bins are full for once. Nothing to fetch.\"",
    later: "\"I've enough to be going on with. Ask me again tomorrow.\"",
    why: "for the forge",
  },
  captain: {
    kinds: ["clearCamp", "defend"], goods: [],
    ask: "\"I've a job for someone with a sword and no fear of the dark. My men are stretched as it is.\"",
    nothing: "\"No camp within a day's march that I know of. Quiet, for once.\"",
    later: "\"Nothing more I can spare you for. Report back tomorrow.\"",
    why: "for the watch",
  },
};

// Which quest kinds a role asks for now (the captain's defence only at night, first).
export function roleQuestKinds(role: QuestRole, night: boolean): QuestKind[] {
  const k = ROLE_QUESTS[role].kinds;
  if (role === "captain") return night ? ["defend", "clearCamp"] : ["clearCamp"];
  return [...k];
}

// The good a deliver role asks for: one it is short of (stock under `short`) first, never one already asked for
// (`taken`); else the first of its goods it is not already asking for. `roll` (0-1) picks among the short ones.
export function roleQuestGood(role: QuestRole, stock: Partial<Record<TradeGood, number>>, taken: ReadonlySet<TradeGood | undefined>, short: number, roll: number): TradeGood | undefined {
  const free = ROLE_QUESTS[role].goods.filter((g) => !taken.has(g));
  if (free.length === 0) return undefined;
  const lacking = free.filter((g) => (stock[g] ?? 0) < short);
  const pool = lacking.length ? lacking : free;
  return pool[Math.min(pool.length - 1, Math.floor(roll * pool.length))];
}

// ---- their favours (once a game day, after at least ROLE_FAVOUR_NEEDED of their quests done) ----
export const ROLE_FAVOUR_NEEDED = 1;
// Smith: tools forged for your stores. Merchant: a parcel of the settlement's own goods (from its stock). Captain: his
// scouts' report (every camp within range revealed). Priest: a blessing (the hero healed and rested).
export const SMITH_FAVOUR_TOOLS = 2;
export const TRADER_FAVOUR_GOODS = 5;
export const CAPTAIN_SCOUT_RANGE_TILES = 60;
export interface RolePerkDef {
  label: string;
  // Their line when you ask too soon (no service done yet).
  stranger: string;
}
export const ROLE_PERKS: Record<QuestRole, RolePerkDef> = {
  trader: { label: "Anything put by for a friend?", stranger: "Do the merchant a service first" },
  priest: { label: "Bless me, Brother.", stranger: "Help the poor of this place first" },
  smith: { label: "Could you forge me a few tools?", stranger: "Help the forge first" },
  captain: { label: "What do your scouts report?", stranger: "Do the watch a service first" },
};
// Said in the greeting by someone you have helped (favour >= ROLE_FAVOUR_NEEDED).
export const ROLE_REMEMBERS: Record<QuestRole, string> = {
  trader: "\"My friend! That last load sold before it was off the cart.\"",
  priest: "\"The Saint's blessing on you. The poor still speak of your gift.\"",
  smith: "\"Ha! The one who keeps my forge fed. Good iron, that was.\"",
  captain: "\"You've stood with the watch before. The men remember it.\"",
};
