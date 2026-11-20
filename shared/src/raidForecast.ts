// Dusk raid forecast (DESIGN-REVIEW-nov20 #4). The server commits a raid's size, faction and entry edge at the day
// midpoint; the snapshot exposes them as a coarse band (never exact numbers) so the player can prepare before
// nightfall. EVERY forecast number lives here; server (index.ts snapshot) and client (HUD row) share it.
export type RaidForecastEdge = "north" | "south" | "east" | "west";
export type RaidForecastBand = "small" | "medium" | "large" | "huge";
export interface RaidForecast {
  band: RaidForecastBand;
  // Distinct faction ids of the committed groups (ids as in the server's RaidFactionId).
  factions: string[];
  // Distinct entry edges of the committed groups (deserter-only groups have none).
  edges: RaidForecastEdge[];
}
// Inclusive upper bound of each band, by raider count; anything above the last is "huge".
export const RAID_FORECAST_BAND_MAX: Record<Exclude<RaidForecastBand, "huge">, number> = { small: 6, medium: 14, large: 30 };
export const RAID_FORECAST_FACTION_LABEL: Record<string, string> = {
  wolfPack: "wolves",
  banditBand: "bandits",
  greenskinWarband: "goblins",
  darkHost: "the dark host",
  riderPack: "wolf riders",
};
export function raidForecastBand(count: number): RaidForecastBand {
  if (count <= RAID_FORECAST_BAND_MAX.small) return "small";
  if (count <= RAID_FORECAST_BAND_MAX.medium) return "medium";
  if (count <= RAID_FORECAST_BAND_MAX.large) return "large";
  return "huge";
}
export function raidForecastText(f: RaidForecast): string {
  const who = f.factions.map((id) => RAID_FORECAST_FACTION_LABEL[id] ?? id).join(", ");
  const from = f.edges.length > 0 ? ` from the ${f.edges.join(" and ")}` : "";
  return `Tonight: a ${f.band} raid (${who})${from}`;
}
