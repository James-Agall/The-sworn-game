// Live raid warnings (shared/src/raidWarning.ts) by raid id: read by the HUD banner (hudStatus.ts) and the minimap markers.
import type { RaidWarning } from "@colony/shared/raidWarning";
export const raidWarningsLive = new Map<string, RaidWarning>();
