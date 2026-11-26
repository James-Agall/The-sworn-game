// autosaves.ts: rotating autosaves (2026-11-26). A normal game's autosaves are numbered files autosave-<n>.json
// (n = 1, 2, 3, ... across restarts: the next n is one past the highest found on disk). After save n is written, the
// history is thinned to: every multiple of 10, the latest multiple of 5 since the last multiple of 10, and n itself.
//   n = 48 -> 10 20 30 40 45 48;  n = 50 -> 10 20 30 40 50;  n = 55 -> 10 .. 50 55;  n = 56 -> 10 .. 50 55 56.
// Only node builtins here (the rule is unit-tested straight from the .ts by server/autosave-rotation-test.mjs).
import { readdirSync } from "node:fs";

// The file names this module ever lists or deletes (canonical numbers only: no leading zeros).
const AUTOSAVE_FILE = /^autosave-([1-9][0-9]{0,8})\.json$/;

export function autosaveFileNumber(name: string): number | null {
  const m = AUTOSAVE_FILE.exec(name);
  return m ? Number(m[1]) : null;
}

// Is autosave k still kept once autosave n is the newest? Anything newer than n is never ours to drop.
export function autosaveKept(k: number, n: number): boolean {
  if (k >= n) return true;
  if (k % 10 === 0) return true;
  return k % 5 === 0 && k > n - (n % 10);
}

// The numbers kept after save n (n plus those of `existing` the rule keeps), ascending.
export function autosavesToKeep(n: number, existing: number[]): number[] {
  return [...new Set([...existing, n])].filter((k) => autosaveKept(k, n)).sort((a, b) => a - b);
}

// The autosave file names in `names` (a save dir listing) to delete after save n; every other name is left alone.
export function autosaveFilesToDelete(n: number, names: string[]): string[] {
  return names.filter((name) => {
    const k = autosaveFileNumber(name);
    return k !== null && !autosaveKept(k, n);
  });
}

// The newest autosave number in a save dir listing (0: none).
export function highestAutosave(names: string[]): number {
  return names.reduce((hi, name) => Math.max(hi, autosaveFileNumber(name) ?? 0), 0);
}

// The series counter: read from disk once (the first autosave after boot), then counted in memory, so a number is
// never handed out twice even when a write fails.
let lastAutosave: number | null = null;
export function nextAutosaveNumber(dir: string): number {
  if (lastAutosave === null) {
    try {
      lastAutosave = highestAutosave(readdirSync(dir));
    } catch {
      lastAutosave = 0; // no save dir yet
    }
  }
  return ++lastAutosave;
}
