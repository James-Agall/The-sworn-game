// Test helper (not a test file): run by area-game.test.ts as
//   node --import tsx --import ../server/stamper/alias.mjs game-store-probe.ts   (cwd <repo>/server)
// with COLONY_CAMP_USER_DIR / COLONY_BUILDING_USER_DIR / COLONY_SETTLEMENT_USER_DIR pointing at a scratch Lab root's
// user folders. It boots the GAME'S OWN template stores (server/src/camps.ts, buildingTemplates.ts,
// settlementTemplates.ts: the loaders the game server runs at boot), prints the user templates they accepted, then
// saves the stdin templates through the game's own save functions into PROBE_SAVE_* folders (for a byte comparison).
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const mod = (rel: string) => import(pathToFileURL(path.join(REPO, rel)).href) as Promise<any>;

const chunks: Buffer[] = [];
for await (const c of process.stdin) chunks.push(c as Buffer);
const input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { save: { kind: string; template: unknown }[] };
const camps = await mod("server/src/camps.ts");
const bt = await mod("server/src/buildingTemplates.ts");
const stt = await mod("server/src/settlementTemplates.ts");
camps.loadCampTemplates();
bt.loadBuildingTemplates();
stt.loadSettlementTemplates();
// Stage B stores (sites, POI pools, the Castle Ruin): COLONY_SITE_USER_DIR / COLONY_POI_USER_DIR / COLONY_CASTLE_RUIN_USER_DIR
const sitesStore = await mod("server/src/siteTemplates.ts");
const poiStore = await mod("server/src/poiTemplates.ts");
const { MOB_KIND_CONFIG } = await mod("server/src/constants.ts");
sitesStore.loadSiteTemplates();
poiStore.loadPoiTemplates();
const users = (all: { id: string; builtin?: boolean }[]) => all.filter((t) => !t.builtin);
const loaded = {
  camps: users(camps.campTemplates()), buildings: users(bt.buildingTemplates()), settlements: users(stt.settlementTemplates()),
  sites: users(sitesStore.siteTemplateFiles()), pois: users(poiStore.poiTemplateFiles()), "castle-ruins": users(poiStore.castleRuinFiles()),
  siteIds: Object.keys(sitesStore.SITE_TEMPLATES),
};
// now save through the game's stores into the probe folders (env switched before the stores resolve their user dir)
process.env.COLONY_CAMP_USER_DIR = process.env.PROBE_SAVE_CAMPS;
process.env.COLONY_BUILDING_USER_DIR = process.env.PROBE_SAVE_BUILDINGS;
process.env.COLONY_SETTLEMENT_USER_DIR = process.env.PROBE_SAVE_SETTLEMENTS;
process.env.COLONY_SITE_USER_DIR = process.env.PROBE_SAVE_SITES;
process.env.COLONY_POI_USER_DIR = process.env.PROBE_SAVE_POIS;
process.env.COLONY_CASTLE_RUIN_USER_DIR = process.env.PROBE_SAVE_CASTLE_RUINS;
const saved: (string | null)[] = [];
for (const s of input.save) {
  if (s.kind === "camps") saved.push(camps.saveUserCamp(s.template));
  else if (s.kind === "buildings") saved.push(bt.saveUserBuilding(s.template));
  else if (s.kind === "sites") saved.push(sitesStore.saveUserSiteTemplate(s.template));
  else if (s.kind === "pois") saved.push(poiStore.saveUserPoiTemplate(s.template));
  else if (s.kind === "castle-ruins") saved.push(poiStore.saveUserCastleRuin(s.template));
  else saved.push(stt.saveUserSettlement(s.template));
}
const mobKinds = Object.keys(MOB_KIND_CONFIG);
process.stdout.write("\n@@RESULT@@" + JSON.stringify({ loaded, saved, mobKinds, sharedFrom: import.meta.resolve("@colony/shared/protocol") }) + "\n", () => process.exit(0));
