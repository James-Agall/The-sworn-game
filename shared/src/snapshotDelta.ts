// Delta snapshots (2026-11-10). A client that connects with `?delta=1` gets snapshots whose units (colonists, mobs)
// are diffs against what that connection was last sent, and whose unchanged bulky sections are named instead of
// repeated. Other clients (and every scripted test) get the full snapshot exactly as before.
//
// Per connection the server keeps the units and section JSON it last sent. Each snapshot carries `ud` (UnitDelta):
//  - s: the connection's snapshot sequence number (1, 2, 3, ...). A gap means the client missed one: it keeps
//    drawing the last state it has and sends { type: "resync" }; the server's next snapshot is a keyframe.
//  - f: 1 on a keyframe (the first snapshot after a welcome, a resync, and every DELTA_KEYFRAME_SENDS): start from
//    empty, every unit is in the added lists and every section is sent.
//  - k: the snapshot keys left out because their value is byte-identical to the last one sent (keep the last one).
//  - sn: strings appended to the connection's string table (restarted by a keyframe); an added row's kind / state /
//    stance is an index into it (DELTA_STRING_FIELDS).
//  - Units are keyed by a short number (n) instead of the 36-char uuid; an added row carries both.
//    ca / ma  added:   [n, ...DELTA_COLONIST_FIELDS / DELTA_MOB_FIELDS values, extras?] (extras = the optional
//                       fields present, as an object; left out when there are none)
//    cp / mp  moved:   flat [n, x, y, ...] (only x / y changed)
//    ch / mh  hit:     flat [n, x, y, hp, ...] (only x / y / hp changed, hp among them)
//    cc / mc  changed: flat [n, partial, ...] (the changed fields; null = the optional field went away)
//    cr / mr  removed: [n, ...]
// armyRegiments / orderGroups `unitIds` and taskForces lists carry a unit's number instead of its id when the
// connection has that unit (mapped back by applySnapshotDelta).
// The rebuilt `colonists` / `mobs` arrays hold the same objects a full snapshot would (order: a unit that is
// added later goes last, as on the server; a culled mob that comes back into view also goes last).
import type { ColonistSnapshot, MobSnapshot } from "./protocol.js";

export const DELTA_COLONIST_FIELDS = ["id", "kind", "x", "y", "state", "hp", "maxHp", "postX", "postY", "stance"] as const;
export const DELTA_MOB_FIELDS = ["id", "kind", "x", "y", "hp", "maxHp"] as const;
// Fixed fields of an added row sent as an index into the connection's string table (see `sn`).
export const DELTA_STRING_FIELDS: ReadonlySet<string> = new Set(["kind", "state", "stance"]);
// A keyframe at least every this many snapshots (30 s at 20 Hz): a cheap safety net, deltas are lossless.
export const DELTA_KEYFRAME_SENDS = 600;

export interface UnitDelta {
  s: number;
  f?: 1;
  k?: string[];
  sn?: string[];
  ca?: unknown[][];
  cp?: number[];
  ch?: number[];
  cc?: unknown[];
  cr?: number[];
  ma?: unknown[][];
  mp?: number[];
  mh?: number[];
  mc?: unknown[];
  mr?: number[];
}

export interface DeltaClientState {
  // Last applied sequence number (0 = none yet).
  seq: number;
  // A resync was requested and no keyframe has come since (don't ask again).
  awaitingKeyframe: boolean;
  colonists: Map<number, ColonistSnapshot>;
  mobs: Map<number, MobSnapshot>;
  // The last value of every snapshot section received (refills the `k` keys).
  sections: Map<string, unknown>;
  // The connection's string table (restarted by each keyframe, grown by `sn`).
  strings: string[];
}

export function newDeltaClientState(): DeltaClientState {
  return { seq: 0, awaitingKeyframe: false, colonists: new Map(), mobs: new Map(), sections: new Map(), strings: [] };
}

type Row = Record<string, unknown>;

function applyUnits(
  strings: string[],
  map: Map<number, Row>,
  fields: readonly string[],
  added: unknown[][] | undefined,
  moved: number[] | undefined,
  hit: number[] | undefined,
  changed: unknown[] | undefined,
  removed: number[] | undefined,
) {
  if (removed) for (const n of removed) map.delete(n);
  if (added) {
    for (const row of added) {
      const obj: Row = {};
      for (let i = 0; i < fields.length; i++) {
        const v = row[i + 1];
        obj[fields[i]] = typeof v === "number" && DELTA_STRING_FIELDS.has(fields[i]) ? strings[v] : v;
      }
      const extras = row[fields.length + 1] as Row | undefined;
      if (extras) Object.assign(obj, extras);
      map.set(row[0] as number, obj);
    }
  }
  if (moved) {
    for (let i = 0; i + 2 < moved.length; i += 3) {
      const old = map.get(moved[i]);
      if (old) map.set(moved[i], { ...old, x: moved[i + 1], y: moved[i + 2] });
    }
  }
  if (hit) {
    for (let i = 0; i + 3 < hit.length; i += 4) {
      const old = map.get(hit[i]);
      if (old) map.set(hit[i], { ...old, x: hit[i + 1], y: hit[i + 2], hp: hit[i + 3] });
    }
  }
  if (changed) {
    for (let i = 0; i + 1 < changed.length; i += 2) {
      const n = changed[i] as number;
      const old = map.get(n);
      if (!old) continue;
      const obj: Row = { ...old };
      for (const [key, value] of Object.entries(changed[i + 1] as Row)) {
        if (value === null) delete obj[key];
        else obj[key] = value;
      }
      map.set(n, obj);
    }
  }
}

// Applies a delta snapshot to `st` and fills `msg` in place (colonists, mobs, and the `k` sections), so the rest of
// the client reads it like a full snapshot. Returns true when the client should send { type: "resync" } (a
// sequence gap; the message is then filled from the last known state, its unit changes are not applied).
export function applySnapshotDelta(st: DeltaClientState, msg: Record<string, unknown>): boolean {
  const ud = msg.ud as UnitDelta | undefined;
  if (!ud) return false;
  delete msg.ud;
  let wantResync = false;
  if (ud.f) {
    st.colonists.clear();
    st.mobs.clear();
    st.sections.clear();
    st.strings = [];
    st.awaitingKeyframe = false;
  } else if (ud.s !== st.seq + 1 || st.awaitingKeyframe) {
    wantResync = !st.awaitingKeyframe;
    st.awaitingKeyframe = true;
  }
  if (!st.awaitingKeyframe) {
    st.seq = ud.s;
    if (ud.sn) st.strings.push(...ud.sn);
    applyUnits(st.strings, st.colonists as unknown as Map<number, Row>, DELTA_COLONIST_FIELDS, ud.ca, ud.cp, ud.ch, ud.cc, ud.cr);
    applyUnits(st.strings, st.mobs as unknown as Map<number, Row>, DELTA_MOB_FIELDS, ud.ma, ud.mp, ud.mh, ud.mc, ud.mr);
  }
  if (st.awaitingKeyframe) {
    // Unit numbers can't be mapped without this delta's units: keep the last id lists until the keyframe.
    delete msg.armyRegiments;
    delete msg.orderGroups;
    msg.taskForces = st.sections.get("taskForces") ?? {};
  }
  // Unit numbers in the id-list sections back to ids (the units were applied above).
  const dec = (v: unknown) => (typeof v === "number" ? (st.colonists.get(v)?.id ?? String(v)) : v);
  for (const key of ["armyRegiments", "orderGroups"]) {
    const list = msg[key] as { unitIds: unknown[] }[] | undefined;
    if (list) msg[key] = list.map((e) => ({ ...e, unitIds: e.unitIds.map(dec) }));
  }
  const tf = msg.taskForces as Record<string, unknown[]> | undefined;
  if (tf) msg.taskForces = Object.fromEntries(Object.entries(tf).map(([k, ids]) => [k, ids.map(dec)]));
  for (const [key, value] of Object.entries(msg)) if (key !== "type") st.sections.set(key, value);
  if (ud.k) for (const key of ud.k) if (st.sections.has(key)) msg[key] = st.sections.get(key);
  msg.colonists = Array.from(st.colonists.values());
  msg.mobs = Array.from(st.mobs.values());
  return wantResync;
}
