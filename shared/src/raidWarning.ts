// Raid warning (2026-11-27): what the server tells the owning clan's players while a raid spawns and marches.
// Server (raids.ts) builds it, client (HUD banner + minimap marker) draws it.
export type CompassDir = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
export const COMPASS_DIRS: readonly CompassDir[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export interface RaidWarning {
  // Stable per raid (every group of one spawnRaid call shares it).
  id: string;
  // Where the raiders are, seen from the Town Center (y grows south on screen).
  dir: CompassDir;
  // Walking distance (tiles) the lead group still has to cover to the Town Center, and the estimated ticks to get there.
  distanceTiles: number;
  etaTicks: number;
  // Raiders still marching / waiting (not yet in contact), their centre tile, and the Town Center tile.
  count: number;
  tx: number;
  ty: number;
  homeX: number;
  homeY: number;
}
export type RaidWarningClearReason = "contact" | "defeated" | "expired";
export interface RaidWarningCleared {
  id: string;
  reason: RaidWarningClearReason;
}
// Compass point of the vector (dx, dy) in tile / pixel space (y down): N is up the screen.
export function compassDirection(dx: number, dy: number): CompassDir {
  if (dx === 0 && dy === 0) return "N";
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI; // 0 = north, 90 = east
  return COMPASS_DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export function isRaidWarning(v: unknown): v is RaidWarning {
  if (!v || typeof v !== "object") return false;
  const w = v as Record<string, unknown>;
  return (
    typeof w.id === "string" && w.id.length > 0 && w.id.length <= 64 &&
    typeof w.dir === "string" && (COMPASS_DIRS as readonly string[]).includes(w.dir) &&
    finite(w.distanceTiles) && w.distanceTiles >= 0 && finite(w.etaTicks) && w.etaTicks >= 0 &&
    finite(w.count) && w.count >= 0 && finite(w.tx) && finite(w.ty) && finite(w.homeX) && finite(w.homeY)
  );
}
export function isRaidWarningCleared(v: unknown): v is RaidWarningCleared {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return typeof c.id === "string" && (c.reason === "contact" || c.reason === "defeated" || c.reason === "expired");
}
export function raidWarningText(w: RaidWarning, tickRate = 20): string {
  const secs = Math.max(0, Math.round(w.etaTicks / tickRate));
  const eta = secs >= 90 ? `${Math.round(secs / 60)} min` : `${secs} s`;
  return `Raiders approaching from the ${w.dir}: ${Math.round(w.distanceTiles)} tiles away, about ${eta}`;
}
export function raidClearedText(c: RaidWarningCleared): string {
  return c.reason === "defeated" ? "The raid has been beaten off" : c.reason === "contact" ? "The raid is upon the colony" : "The raid has dispersed";
}
