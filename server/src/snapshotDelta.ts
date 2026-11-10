// Delta snapshots (2026-11-10): the server half of shared/src/snapshotDelta.ts (format and rules there). Only for
// connections that asked with `?delta=1` (the browser client); everyone else gets the full snapshot as before.
import type { ColonistSnapshot, MobSnapshot, ServerMessage } from "@colony/shared/protocol";
import { DELTA_COLONIST_FIELDS, DELTA_KEYFRAME_SENDS, DELTA_MOB_FIELDS, DELTA_STRING_FIELDS } from "@colony/shared/snapshotDelta";

type Snapshot = Extract<ServerMessage, { type: "snapshot" }>;
type Row = Record<string, unknown>;

export interface PlayerDeltaState {
  seq: number;
  // The next snapshot is a keyframe (set on connect, by every welcome and by a resync request).
  keyframe: boolean;
  sendsSinceKeyframe: number;
  colonists: Map<number, Row>;
  mobs: Map<number, Row>;
  // Section key -> the JSON last sent for it.
  sections: Map<string, string>;
  // String table (kind / state / stance of added rows) -> index; restarted on every keyframe.
  strings: Map<string, number>;
}

export function newPlayerDeltaState(): PlayerDeltaState {
  return { seq: 0, keyframe: true, sendsSinceKeyframe: 0, colonists: new Map(), mobs: new Map(), sections: new Map(), strings: new Map() };
}

// Short unit numbers, shared by every connection (a number is never reused; ids of units gone are dropped).
const colonistNums = new Map<string, number>();
const mobNums = new Map<string, number>();
let nextNum = 1;
function numFor(nums: Map<string, number>, id: string): number {
  let n = nums.get(id);
  if (n === undefined) {
    n = nextNum++;
    nums.set(id, n);
  }
  return n;
}

// Once per broadcast, before encoding: forget the numbers of units no longer in the world.
export function pruneDeltaNums(liveColonists: { has(id: string): boolean }, liveMobs: { has(id: string): boolean }) {
  for (const id of colonistNums.keys()) if (!liveColonists.has(id)) colonistNums.delete(id);
  for (const id of mobNums.keys()) if (!liveMobs.has(id)) mobNums.delete(id);
}

// Sections that are not state (sent every time) or are already "only when changed, keep the last one" on the
// client (left out when unchanged, never named in `k`).
const ALWAYS_SENT = new Set(["type", "colonists", "mobs", "effects"]);
const KEEP_LAST = new Set(["armyRegiments", "orderGroups"]);
// Shorter sections cost less to send than to name.
const MIN_SKIP_LEN = 24;

// JSON per section value, shared across connections in one broadcast (the same object for every player of a clan).
let jsonCache = new WeakMap<object, string>();
export function resetDeltaJsonCache() {
  jsonCache = new WeakMap();
}
function jsonOf(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  let json = jsonCache.get(value);
  if (json === undefined) {
    json = JSON.stringify(value);
    jsonCache.set(value, json);
  }
  return json;
}

const sameValue = (a: unknown, b: unknown) =>
  a === b || (typeof a === "object" && a !== null && typeof b === "object" && b !== null && JSON.stringify(a) === JSON.stringify(b));

function diffUnits(
  list: Row[],
  nums: Map<string, number>,
  last: Map<number, Row>,
  fields: readonly string[],
  keyframe: boolean,
  str: (v: string) => number,
) {
  const added: unknown[][] = [];
  const moved: number[] = [];
  const hit: number[] = [];
  const changed: unknown[] = [];
  const next = new Map<number, Row>();
  for (const obj of list) {
    const n = numFor(nums, obj.id as string);
    next.set(n, obj);
    const prev = keyframe ? undefined : last.get(n);
    if (!prev) {
      const row: unknown[] = [n];
      for (const f of fields) row.push(DELTA_STRING_FIELDS.has(f) && typeof obj[f] === "string" ? str(obj[f] as string) : obj[f]);
      let extras: Row | null = null;
      for (const key in obj) {
        if (fields.includes(key) || obj[key] === undefined) continue;
        (extras ??= {})[key] = obj[key];
      }
      if (extras) row.push(extras);
      added.push(row);
      continue;
    }
    last.delete(n);
    let partial: Row | null = null;
    let other = false;
    for (const key in obj) {
      const v = obj[key];
      if (v === undefined || sameValue(v, prev[key])) continue;
      (partial ??= {})[key] = v;
      if (key !== "x" && key !== "y" && key !== "hp") other = true;
    }
    for (const key in prev) {
      if (prev[key] !== undefined && obj[key] === undefined) {
        (partial ??= {})[key] = null;
        other = true;
      }
    }
    if (!partial) continue;
    if (other) changed.push(n, partial);
    else if ("hp" in partial) hit.push(n, obj.x as number, obj.y as number, obj.hp as number);
    else moved.push(n, obj.x as number, obj.y as number);
  }
  // Whatever is left in `last` was sent before and is gone now (dead, or culled out of view).
  const removed = keyframe ? [] : Array.from(last.keys());
  return { added, moved, hit, changed, removed, next };
}

// Sections listing colonist ids (`unitIds` of each entry, or a record of id lists): ids this connection has as
// units go out as their short numbers (the client maps them back), the rest as they are.
const UNIT_ID_SECTIONS = new Set(["armyRegiments", "orderGroups", "taskForces"]);
function withUnitNums(key: string, value: unknown, st: PlayerDeltaState): unknown {
  const enc = (id: string) => {
    const n = colonistNums.get(id);
    return n !== undefined && st.colonists.has(n) ? n : id;
  };
  if (key === "taskForces") {
    return Object.fromEntries(Object.entries(value as Record<string, string[]>).map(([k, ids]) => [k, ids.map(enc)]));
  }
  return (value as { unitIds: string[] }[]).map((e) => ({ ...e, unitIds: e.unitIds.map(enc) }));
}

// The snapshot JSON for a delta connection. `snap` is what a full client would get (already culled to the view).
export function encodeDeltaSnapshot(st: PlayerDeltaState, snap: Snapshot): string {
  const keyframe = st.keyframe || st.sendsSinceKeyframe >= DELTA_KEYFRAME_SENDS;
  st.keyframe = false;
  st.sendsSinceKeyframe = keyframe ? 0 : st.sendsSinceKeyframe + 1;
  st.seq++;
  if (keyframe) {
    st.sections.clear();
    st.strings.clear();
  }
  const newStrings: string[] = [];
  const str = (v: string) => {
    let i = st.strings.get(v);
    if (i === undefined) {
      i = st.strings.size;
      st.strings.set(v, i);
      newStrings.push(v);
    }
    return i;
  };
  const c = diffUnits(snap.colonists as unknown as Row[], colonistNums, st.colonists, DELTA_COLONIST_FIELDS, keyframe, str);
  const m = diffUnits(snap.mobs as unknown as Row[], mobNums, st.mobs, DELTA_MOB_FIELDS, keyframe, str);
  st.colonists = c.next;
  st.mobs = m.next;

  const parts: string[] = ['"type":"snapshot"'];
  const skipped: string[] = [];
  for (const key in snap) {
    const value = (snap as unknown as Row)[key];
    if (value === undefined || key === "type" || key === "colonists" || key === "mobs") continue;
    const json = UNIT_ID_SECTIONS.has(key) ? JSON.stringify(withUnitNums(key, value, st)) : jsonOf(value);
    if (!ALWAYS_SENT.has(key) && json.length >= MIN_SKIP_LEN) {
      if (st.sections.get(key) === json) {
        if (!KEEP_LAST.has(key)) skipped.push(key);
        continue;
      }
      st.sections.set(key, json);
    }
    parts.push(`${JSON.stringify(key)}:${json}`);
  }
  const ud: Row = { s: st.seq };
  if (keyframe) ud.f = 1;
  if (newStrings.length) ud.sn = newStrings;
  if (skipped.length) ud.k = skipped;
  if (c.added.length) ud.ca = c.added;
  if (c.moved.length) ud.cp = c.moved;
  if (c.hit.length) ud.ch = c.hit;
  if (c.changed.length) ud.cc = c.changed;
  if (c.removed.length) ud.cr = c.removed;
  if (m.added.length) ud.ma = m.added;
  if (m.moved.length) ud.mp = m.moved;
  if (m.hit.length) ud.mh = m.hit;
  if (m.changed.length) ud.mc = m.changed;
  if (m.removed.length) ud.mr = m.removed;
  parts.push(`"ud":${JSON.stringify(ud)}`);
  return `{${parts.join(",")}}`;
}
