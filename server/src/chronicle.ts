// chronicle.ts: World streaming phase 5 (PLAN-world-streaming.md §8 "news feed"). A world log of what happened
// out of sight: abstract raids, wagon outcomes, camp growth, settlement strife. The last CHRONICLE_MAX entries
// are saved with the world. Every client gets the list in a `chronicle` message after its welcome, with the id
// its profile last read (`since`: the client shows newer entries as "while you were away"), and each new entry
// as it happens; `chronicleSeen` moves the profile's mark.
import type { ChronicleEntry, ChronicleKind, ServerMessage } from "@colony/shared/protocol";
import type { Player } from "./types.js";
import { players, state } from "./state.js";
import { GAME_DAY_TICKS } from "./constants.js";

const CHRONICLE_MAX = 120;
const entries: ChronicleEntry[] = [];
let nextId = 1;
// Profile key -> the last entry id it has read.
const seen = new Map<string, number>();

function send(p: Player, m: ServerMessage) {
  if (p.socket.readyState === p.socket.OPEN) p.socket.send(JSON.stringify(m));
}

export function chronicle(kind: ChronicleKind, text: string, at?: { x: number; y: number }) {
  const e: ChronicleEntry = { id: nextId++, day: Math.floor(state.cycleTick / GAME_DAY_TICKS) + 1, kind, text, ...(at ? { x: Math.round(at.x), y: Math.round(at.y) } : {}) };
  entries.push(e);
  if (entries.length > CHRONICLE_MAX) entries.splice(0, entries.length - CHRONICLE_MAX);
  for (const p of players.values()) send(p, { type: "chronicle", entries: [e] });
}

export function sendChronicle(p: Player) {
  send(p, { type: "chronicle", entries: [...entries], since: seen.get(p.profileKey) ?? 0, full: true });
}

export function markChronicleSeen(p: Player, id: unknown) {
  if (typeof id !== "number" || !Number.isFinite(id)) return;
  seen.set(p.profileKey, Math.max(seen.get(p.profileKey) ?? 0, Math.min(nextId - 1, Math.floor(id))));
}

export function chronicleEntries(): readonly ChronicleEntry[] {
  return entries;
}

export function chronicleForSave() {
  return { nextId, entries: [...entries], seen: Array.from(seen) };
}

export function restoreChronicle(saved: ReturnType<typeof chronicleForSave> | undefined) {
  entries.length = 0;
  seen.clear();
  nextId = saved?.nextId ?? 1;
  entries.push(...(saved?.entries ?? []));
  for (const [k, v] of saved?.seen ?? []) seen.set(k, v);
}
